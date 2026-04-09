package telemetry

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// CrashReport is sent to /api/v1/agent/crash on unrecovered panic.
type CrashReport struct {
	AgentVersion string    `json:"agent_version"`
	OS           string    `json:"os"`
	Arch         string    `json:"arch"`
	OrgID        string    `json:"org_id"`
	EmployeeID   string    `json:"employee_id"`
	ErrorType    string    `json:"error_type"` // always "panic"
	Message      string    `json:"message"`
	StackTrace   string    `json:"stack_trace"`
	UptimeSec    int64     `json:"uptime_sec"`
	ReportedAt   time.Time `json:"reported_at"`
}

// Reporter sends crash reports to the API on panic.
type Reporter struct {
	apiURL     string
	dataDir    string
	startedAt  time.Time
	orgID      string
	employeeID string
	version    string
}

func NewReporter(apiURL, dataDir, orgID, employeeID, version string) *Reporter {
	return &Reporter{
		apiURL:     apiURL,
		dataDir:    dataDir,
		startedAt:  time.Now(),
		orgID:      orgID,
		employeeID: employeeID,
		version:    version,
	}
}

// Recover must be deferred at the top of the main run loop.
// It catches panics, sends a crash report, then re-panics so
// deferred cleanup (PID file removal, health server shutdown) still runs.
func (r *Reporter) Recover() {
	v := recover()
	if v == nil {
		return
	}
	buf := make([]byte, 8192)
	n := runtime.Stack(buf, false)
	report := CrashReport{
		AgentVersion: r.version,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		OrgID:        r.orgID,
		EmployeeID:   r.employeeID,
		ErrorType:    "panic",
		Message:      fmt.Sprintf("%v", v),
		StackTrace:   string(buf[:n]),
		UptimeSec:    int64(time.Since(r.startedAt).Seconds()),
		ReportedAt:   time.Now(),
	}
	r.send(report)
	panic(v) // re-panic so other deferred cleanup still runs
}

func (r *Reporter) send(report CrashReport) {
	body, err := json.Marshal(report)
	if err != nil {
		log.Printf("crash reporter: marshal failed: %v", err)
		r.writeLocal(report)
		return
	}
	client := &http.Client{Timeout: 5 * time.Second}
	apiURL := strings.TrimRight(r.apiURL, "/") + "/api/v1/agent/crash"

	for i := 0; i < 3; i++ {
		if i > 0 {
			time.Sleep(time.Second)
		}
		resp, err := client.Post(apiURL, "application/json", bytes.NewReader(body))
		if err != nil {
			continue
		}
		resp.Body.Close()
		if resp.StatusCode < 300 {
			return // success
		}
		// 4xx/5xx: treat as transient failure and retry
		log.Printf("crash reporter: server returned %d (attempt %d/3)", resp.StatusCode, i+1)
	}
	// Last resort: write to local crash.log if API is unreachable.
	r.writeLocal(report)
}

func (r *Reporter) writeLocal(report CrashReport) {
	line, _ := json.Marshal(report)
	path := filepath.Join(r.dataDir, "crash.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		log.Printf("crash reporter: could not write crash.log: %v", err)
		return
	}
	defer f.Close()
	f.Write(line)
	f.WriteString("\n")
}
