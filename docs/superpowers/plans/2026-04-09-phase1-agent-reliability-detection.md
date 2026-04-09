# Phase 1: Agent Reliability + Permissions + Accurate Detection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop agent crash-proof, permission-aware on macOS/Windows, and accurately detect active windows + browser URLs across all 3 platforms.

**Architecture:** Layered capture stack — platform-native window APIs feed a 3-layer URL resolver (native extension → Accessibility API → title parsing). A health HTTP server replaces PID-file-only liveness checks. A crash reporter sends panic stack traces to the API. Jitter on all sync intervals eliminates thundering herd.

**Tech Stack:** Go 1.22, CGo (macOS Accessibility/CoreGraphics), Win32 API via syscall, X11 via cgo, SQLite WAL, OS keychain

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/agent/internal/health/server.go` | Create | HTTP health endpoint :27183 |
| `apps/agent/internal/telemetry/crash.go` | Create | Panic recovery + crash reporter |
| `apps/agent/internal/telemetry/loki_writer.go` | Create | Log shipping to Loki |
| `apps/agent/internal/telemetry/agent_metrics.go` | Create | Agent self-telemetry struct + emit |
| `apps/agent/internal/sync/jitter.go` | Create | Jittered ticker (±30%) |
| `apps/agent/internal/sync/retry.go` | Create | Full-jitter exponential backoff |
| `apps/agent/internal/capture/permissions_darwin.go` | Create | macOS permission check/request |
| `apps/agent/internal/capture/permissions_windows.go` | Create | Windows permission check (UAC) |
| `apps/agent/internal/capture/permissions_linux.go` | Create | Linux permission check (X11) |
| `apps/agent/internal/capture/window_darwin.go` | Modify | Use Accessibility API for titles |
| `apps/agent/internal/capture/window_windows.go` | Modify | Add UI Automation for browser URL |
| `apps/agent/internal/capture/window_linux.go` | Modify | Improve X11 + Wayland fallback |
| `apps/agent/internal/capture/browser_url.go` | Create | 3-layer URL resolver (all platforms) |
| `apps/agent/internal/capture/browser_url_darwin.go` | Create | AX address bar scraping (macOS) |
| `apps/agent/internal/capture/browser_url_windows.go` | Create | UI Automation address bar (Windows) |
| `apps/agent/cmd/agent/main.go` | Modify | Wire health server, crash reporter, jitter, telemetry |
| `apps/agent/cmd/tray/app.go` | Modify | monitorAgent pings health endpoint instead of PID |

---

## Task 1: Health HTTP Server

The tray's `monitorAgent` currently checks a PID file. PID files can be stale (agent crashed before removing it). A local HTTP endpoint cannot lie — if it responds, the agent is alive.

**Files:**
- Create: `apps/agent/internal/health/server.go`
- Modify: `apps/agent/cmd/agent/main.go`
- Modify: `apps/agent/cmd/tray/app.go`

- [ ] **Step 1.1: Create health server**

```go
// apps/agent/internal/health/server.go
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const Addr = "127.0.0.1:27183"

type Server struct {
	startedAt time.Time
	version   string
	server    *http.Server
}

type Response struct {
	Status  string `json:"status"`
	Uptime  int64  `json:"uptime_sec"`
	Version string `json:"version"`
}

func New(version string) *Server {
	s := &Server{startedAt: time.Now(), version: version}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	s.server = &http.Server{
		Addr:         Addr,
		Handler:      mux,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	}
	return s
}

func (s *Server) Start() {
	go func() {
		// Ignore error — port may already be in use if two instances race
		_ = s.server.ListenAndServe()
	}()
}

func (s *Server) Stop(ctx context.Context) {
	_ = s.server.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Status:  "ok",
		Uptime:  int64(time.Since(s.startedAt).Seconds()),
		Version: s.version,
	})
}
```

- [ ] **Step 1.2: Wire health server into agent main.go**

In `apps/agent/cmd/agent/main.go`, after the PID file write (line ~215), add:

```go
// Start local health HTTP server — tray uses this to detect liveness.
healthSrv := health.New(Version)
healthSrv.Start()
defer func() {
    ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
    defer cancel()
    healthSrv.Stop(ctx)
}()
```

Add import: `"github.com/timechamp/agent/internal/health"`

- [ ] **Step 1.3: Update tray monitorAgent to ping health endpoint**

In `apps/agent/cmd/tray/app.go`, replace `isAgentRunning` with a version that pings the health endpoint first:

```go
// isAgentRunning checks liveness via the agent's health HTTP endpoint.
// Falls back to PID file + OpenProcess if health endpoint is unreachable
// (covers the startup window before the HTTP server is ready).
func (a *App) isAgentRunning(dataDir string) bool {
	// Primary check: HTTP health endpoint (cannot lie — if it responds, agent is alive)
	client := &http.Client{Timeout: 1 * time.Second}
	resp, err := client.Get("http://127.0.0.1:27183/health")
	if err == nil {
		resp.Body.Close()
		return resp.StatusCode == 200
	}

	// Fallback: PID file + Windows OpenProcess (covers startup race)
	pidFile := filepath.Join(dataDir, "agent.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return false
	}
	var pid int
	if err := json.Unmarshal(data, &pid); err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
		kernel32 := syscall.NewLazyDLL("kernel32.dll")
		handle, _, _ := kernel32.NewProc("OpenProcess").Call(
			PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid))
		if handle == 0 {
			return false
		}
		var exitCode uint32
		kernel32.NewProc("GetExitCodeProcess").Call(handle, uintptr(unsafe.Pointer(&exitCode)))
		kernel32.NewProc("CloseHandle").Call(handle)
		return exitCode == 259 // STILL_ACTIVE
	}
	proc, err := os.FindProcess(pid)
	if err != nil || proc == nil {
		return false
	}
	return proc.Signal(os.Signal(nil)) == nil
}
```

- [ ] **Step 1.4: Build agent to verify it compiles**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build -p 1 ./cmd/agent
GOOS=darwin  GOARCH=amd64 go build -p 1 ./cmd/agent
GOOS=linux   GOARCH=amd64 go build -p 1 ./cmd/agent
```

Expected: no errors on all 3 platforms

- [ ] **Step 1.5: Commit**

```bash
git add apps/agent/internal/health/server.go apps/agent/cmd/agent/main.go apps/agent/cmd/tray/app.go
git commit -m "feat(agent): health HTTP server + tray liveness check via HTTP"
```

---

## Task 2: Jitter Sync Ticker

Without jitter, 110k agents syncing every 30s = 110k simultaneous HTTP requests. With ±30% jitter the load spreads over a 21–39s window.

**Files:**
- Create: `apps/agent/internal/sync/jitter.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] **Step 2.1: Create jitter package**

```go
// apps/agent/internal/sync/jitter.go
package sync

import (
	"math/rand"
	"time"
)

// NewJitteredTicker returns a ticker that fires at base ± 30%.
// Example: base=30s → fires between 21s and 39s.
// Each tick interval is independently randomised.
func NewJitteredTicker(base time.Duration) *jitteredTicker {
	t := &jitteredTicker{
		base: base,
		C:    make(chan time.Time, 1),
		stop: make(chan struct{}),
	}
	go t.run()
	return t
}

type jitteredTicker struct {
	base time.Duration
	C    chan time.Time
	stop chan struct{}
}

func (t *jitteredTicker) Stop() { close(t.stop) }

func (t *jitteredTicker) run() {
	for {
		// Full interval in [0.7*base, 1.3*base]
		interval := time.Duration(float64(t.base) * (0.7 + rand.Float64()*0.6))
		select {
		case <-time.After(interval):
			select {
			case t.C <- time.Now():
			default: // drop tick if consumer is slow
			}
		case <-t.stop:
			return
		}
	}
}
```

- [ ] **Step 2.2: Write unit test**

```go
// apps/agent/internal/sync/jitter_test.go
package sync_test

import (
	"testing"
	"time"

	agentsync "github.com/timechamp/agent/internal/sync"
)

func TestJitteredTicker_StaysWithinBounds(t *testing.T) {
	base := 100 * time.Millisecond
	ticker := agentsync.NewJitteredTicker(base)
	defer ticker.Stop()

	for i := 0; i < 10; i++ {
		start := time.Now()
		<-ticker.C
		elapsed := time.Since(start)
		min := time.Duration(float64(base) * 0.65) // 5% margin
		max := time.Duration(float64(base) * 1.35)
		if elapsed < min || elapsed > max {
			t.Errorf("tick %d: elapsed %v not in [%v, %v]", i, elapsed, min, max)
		}
	}
}
```

- [ ] **Step 2.3: Run test**

```bash
cd apps/agent
go test ./internal/sync/ -run TestJitteredTicker -v
```

Expected: `PASS`

- [ ] **Step 2.4: Replace sync ticker in main.go**

In `apps/agent/cmd/agent/main.go`, find the ticker declarations (~line 222) and replace `syncTicker`:

```go
// BEFORE:
syncTicker := time.NewTicker(time.Duration(cfg.SyncInterval) * time.Second)
defer syncTicker.Stop()

// AFTER:
syncTicker := agentsync.NewJitteredTicker(time.Duration(cfg.SyncInterval) * time.Second)
defer syncTicker.Stop()
```

Change the select case from `case <-syncTicker.C:` — no change needed, channel name is the same.

Add import alias if not already present: `agentsync "github.com/timechamp/agent/internal/sync"`

- [ ] **Step 2.5: Commit**

```bash
git add apps/agent/internal/sync/jitter.go apps/agent/internal/sync/jitter_test.go apps/agent/cmd/agent/main.go
git commit -m "feat(agent): jitter sync ticker ±30% to eliminate thundering herd"
```

---

## Task 3: Full-Jitter Retry With Exponential Backoff

Replace the current fixed-interval retry with full-jitter exponential backoff (proven to be the best strategy for reducing correlated retries across a fleet).

**Files:**
- Create: `apps/agent/internal/sync/retry.go`
- Modify: `apps/agent/internal/sync/client.go`

- [ ] **Step 3.1: Create retry package**

```go
// apps/agent/internal/sync/retry.go
package sync

import (
	"math/rand"
	"time"
)

// RetryConfig controls exponential backoff behaviour.
type RetryConfig struct {
	InitialInterval time.Duration // first sleep after failure
	MaxInterval     time.Duration // cap on sleep duration
	Multiplier      float64       // growth factor per attempt
	MaxElapsedTime  time.Duration // give up after this total time (0 = forever)
}

// DefaultRetry is the recommended config for agent → API sync.
var DefaultRetry = RetryConfig{
	InitialInterval: 2 * time.Second,
	MaxInterval:     5 * time.Minute,
	Multiplier:      2.0,
	MaxElapsedTime:  30 * time.Minute,
}

// isPermanentError returns true for errors that should not be retried.
// 400 = bad payload (won't improve), 401/403 = auth (retry won't help).
func isPermanentHTTPStatus(code int) bool {
	return code == 400 || code == 401 || code == 403 || code == 404
}

// WithRetry calls fn repeatedly using full-jitter exponential backoff.
// fn should return (isPermanent, error). If isPermanent is true, retry stops.
func WithRetry(cfg RetryConfig, fn func() (permanent bool, err error)) error {
	interval := cfg.InitialInterval
	start := time.Now()

	for {
		permanent, err := fn()
		if err == nil {
			return nil
		}
		if permanent {
			return err
		}
		if cfg.MaxElapsedTime > 0 && time.Since(start) > cfg.MaxElapsedTime {
			return err
		}
		// Full jitter: sleep uniformly in [0, interval]
		sleep := time.Duration(rand.Float64() * float64(interval))
		time.Sleep(sleep)
		// Grow interval with cap
		interval = time.Duration(float64(interval) * cfg.Multiplier)
		if interval > cfg.MaxInterval {
			interval = cfg.MaxInterval
		}
	}
}
```

- [ ] **Step 3.2: Write unit test**

```go
// apps/agent/internal/sync/retry_test.go
package sync_test

import (
	"errors"
	"testing"
	"time"

	agentsync "github.com/timechamp/agent/internal/sync"
)

func TestWithRetry_SucceedsOnSecondAttempt(t *testing.T) {
	attempt := 0
	err := agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
		MaxElapsedTime:  1 * time.Second,
	}, func() (bool, error) {
		attempt++
		if attempt < 3 {
			return false, errors.New("transient error")
		}
		return false, nil
	})
	if err != nil {
		t.Fatalf("expected success, got: %v", err)
	}
	if attempt != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempt)
	}
}

func TestWithRetry_StopsOnPermanentError(t *testing.T) {
	attempt := 0
	err := agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
	}, func() (bool, error) {
		attempt++
		return true, errors.New("permanent error")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if attempt != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempt)
	}
}

func TestWithRetry_RespectsMaxElapsedTime(t *testing.T) {
	start := time.Now()
	_ = agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 5 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
		MaxElapsedTime:  50 * time.Millisecond,
	}, func() (bool, error) {
		return false, errors.New("always fails")
	})
	elapsed := time.Since(start)
	if elapsed > 200*time.Millisecond {
		t.Fatalf("retry ran too long: %v", elapsed)
	}
}
```

- [ ] **Step 3.3: Run tests**

```bash
cd apps/agent
go test ./internal/sync/ -run TestWithRetry -v
```

Expected: all 3 tests PASS

- [ ] **Step 3.4: Wire retry into client Post method**

In `apps/agent/internal/sync/client.go`, replace the existing retry logic in `Post()`:

```go
func (c *Client) Post(path string, payload any) error {
	return WithRetry(DefaultRetry, func() (permanent bool, err error) {
		code, err := c.doPost(path, payload)
		if err != nil {
			return false, err
		}
		if isPermanentHTTPStatus(code) {
			return true, fmt.Errorf("HTTP %d: permanent error for %s", code, path)
		}
		if code >= 400 {
			return false, fmt.Errorf("HTTP %d: retryable error for %s", code, path)
		}
		return false, nil
	})
}
```

- [ ] **Step 3.5: Commit**

```bash
git add apps/agent/internal/sync/retry.go apps/agent/internal/sync/retry_test.go apps/agent/internal/sync/client.go
git commit -m "feat(agent): full-jitter exponential backoff retry (eliminates correlated retries)"
```

---

## Task 4: Crash Reporter

Uncaught panics currently crash the agent silently. This task wraps `run()` with panic recovery and ships the stack trace to the API.

**Files:**
- Create: `apps/agent/internal/telemetry/crash.go`
- Modify: `apps/agent/cmd/agent/main.go`
- Modify: `apps/api/src/modules/agent/agent-registration.controller.ts` (add /crash endpoint)

- [ ] **Step 4.1: Create crash reporter**

```go
// apps/agent/internal/telemetry/crash.go
package telemetry

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// CrashReport is sent to /v1/agent/crash on unrecovered panic.
type CrashReport struct {
	AgentVersion string    `json:"agent_version"`
	OS           string    `json:"os"`
	Arch         string    `json:"arch"`
	OrgID        string    `json:"org_id"`
	EmployeeID   string    `json:"employee_id"`
	ErrorType    string    `json:"error_type"` // "panic"
	Message      string    `json:"message"`
	StackTrace   string    `json:"stack_trace"`
	UptimeSec    int64     `json:"uptime_sec"`
	ReportedAt   time.Time `json:"reported_at"`
}

// Reporter sends crash reports to the API.
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

// Recover should be deferred at the top of main run loop.
// It catches panics, sends a crash report, then re-panics to allow normal exit.
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
	panic(v) // re-panic so deferred cleanup (PID file removal etc.) still runs
}

func (r *Reporter) send(report CrashReport) {
	body, _ := json.Marshal(report)
	client := &http.Client{Timeout: 5 * time.Second}
	url := r.apiURL + "/api/v1/agent/crash"

	for i := 0; i < 3; i++ {
		resp, err := client.Post(url, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
			return
		}
		time.Sleep(time.Second)
	}
	// Last resort: write to local crash.log
	r.writeLocal(report)
}

func (r *Reporter) writeLocal(report CrashReport) {
	line, _ := json.Marshal(report)
	path := filepath.Join(r.dataDir, "crash.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(line)
	f.WriteString("\n")
}
```

- [ ] **Step 4.2: Wire crash reporter into main.go**

At the start of `run()` in `apps/agent/cmd/agent/main.go`, after loading config and identity:

```go
crashReporter := telemetry.NewReporter(
    cfg.APIURL,
    cfg.DataDir,
    cfg.OrgID,
    cfg.EmployeeID,
    Version,
)
defer crashReporter.Recover()
```

Add import: `"github.com/timechamp/agent/internal/telemetry"`

- [ ] **Step 4.3: Add /crash endpoint to NestJS API**

In `apps/api/src/modules/agent/agent-registration.controller.ts`, add:

```typescript
@Post('crash')
@HttpCode(HttpStatus.ACCEPTED)
@ApiOperation({ summary: 'Receive crash report from agent (unauthenticated)' })
async receiveCrash(@Body() body: any) {
    // Store crash report — no auth required, agent may have lost token
    await this.service.saveCrashReport(body);
    return { received: true };
}
```

In `apps/api/src/modules/agent/agent.service.ts`, add:

```typescript
async saveCrashReport(report: any): Promise<void> {
    // Validate minimum required fields
    if (!report.agent_version || !report.os) return;
    
    await this.supabase
        .from('crash_reports')
        .insert({
            org_id: report.org_id || null,
            employee_id: report.employee_id || null,
            agent_version: report.agent_version,
            os: report.os,
            error_type: report.error_type || 'panic',
            message: String(report.message || '').slice(0, 2000),
            stack_trace: String(report.stack_trace || '').slice(0, 10000),
            uptime_sec: report.uptime_sec || null,
        });
}
```

- [ ] **Step 4.4: Build agent**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build -p 1 ./cmd/agent
```

Expected: no errors

- [ ] **Step 4.5: Commit**

```bash
git add apps/agent/internal/telemetry/crash.go apps/agent/cmd/agent/main.go \
    apps/api/src/modules/agent/agent-registration.controller.ts \
    apps/api/src/modules/agent/agent.service.ts
git commit -m "feat(agent): panic recovery + crash reporter → /api/v1/agent/crash"
```

---

## Task 5: macOS Permission Handling

macOS blocks screen recording and accessibility without explicit user consent. The agent must check, request, and degrade gracefully — never crash.

**Files:**
- Create: `apps/agent/internal/capture/permissions_darwin.go`
- Create: `apps/agent/internal/capture/permissions_windows.go`
- Create: `apps/agent/internal/capture/permissions_linux.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] **Step 5.1: Create macOS permissions file**

```go
// apps/agent/internal/capture/permissions_darwin.go
//go:build darwin

package capture

/*
#cgo LDFLAGS: -framework ApplicationServices -framework CoreGraphics
#include <ApplicationServices/ApplicationServices.h>
#include <CoreGraphics/CoreGraphics.h>

// Returns 1 if screen recording permission is granted, 0 otherwise.
int hasScreenRecording() {
    return CGPreflightScreenCaptureAccess() ? 1 : 0;
}

// Returns 1 if accessibility is trusted, 0 otherwise.
// If prompt=1, shows the system dialog asking the user to grant access.
int hasAccessibility(int prompt) {
    NSDictionary *options = @{(id)kAXTrustedCheckOptionPrompt: @(prompt)};
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options) ? 1 : 0;
}
*/
import "C"
import "sync/atomic"

// PermissionState holds the current permission status for all features.
type PermissionState struct {
	ScreenRecording atomic.Bool
	Accessibility   atomic.Bool
}

// GlobalPermissions is the singleton permission state checked by all capture functions.
var GlobalPermissions = &PermissionState{}

// CheckAndRequestPermissions checks all permissions and prompts for missing ones.
// Call once at startup, then re-check every 60s.
func CheckAndRequestPermissions() {
	// Screen recording: check only, no automatic prompt (macOS shows dialog on first capture attempt)
	GlobalPermissions.ScreenRecording.Store(C.hasScreenRecording() == 1)

	// Accessibility: prompt if missing (shows "TimeChamp wants to control this computer" dialog)
	hasAX := C.hasAccessibility(1) == 1
	GlobalPermissions.Accessibility.Store(hasAX)
}

// HasScreenRecording returns true if the agent can capture screen content.
func HasScreenRecording() bool { return GlobalPermissions.ScreenRecording.Load() }

// HasAccessibility returns true if the agent can read window titles via AX API.
func HasAccessibility() bool { return GlobalPermissions.Accessibility.Load() }
```

- [ ] **Step 5.2: Create Windows permissions stub**

```go
// apps/agent/internal/capture/permissions_windows.go
//go:build windows

package capture

// On Windows, window title and app name access requires no special permissions.
// UAC elevation is requested at install time via the tray manifest.
// All permission checks return true — Windows grants access at process level.

func CheckAndRequestPermissions() {}
func HasScreenRecording() bool    { return true }
func HasAccessibility() bool      { return true }
```

- [ ] **Step 5.3: Create Linux permissions stub**

```go
// apps/agent/internal/capture/permissions_linux.go
//go:build linux

package capture

// On Linux, X11 window access requires no special permissions.
// Wayland restricts window listing by design — we use fallback methods.

func CheckAndRequestPermissions() {}
func HasScreenRecording() bool    { return true }
func HasAccessibility() bool      { return true }
```

- [ ] **Step 5.4: Wire permission checks into agent main.go**

After config load in `run()`, add:

```go
// Check permissions at startup and re-check every 60s.
capture.CheckAndRequestPermissions()
go func() {
    ticker := time.NewTicker(60 * time.Second)
    defer ticker.Stop()
    for range ticker.C {
        capture.CheckAndRequestPermissions()
    }
}()
```

- [ ] **Step 5.5: Guard capture calls with permission checks**

In `apps/agent/cmd/agent/main.go`, in the screenshot ticker case:

```go
case <-screenshotTicker.C:
    // Skip if no screen recording permission (macOS) or user is idle
    if !capture.HasScreenRecording() {
        continue
    }
    idleSec, _ := capture.IdleSeconds()
    if time.Duration(idleSec)*time.Second >= afkThreshold {
        continue
    }
    // ... existing screenshot capture code
```

- [ ] **Step 5.6: Build for macOS to verify CGO compiles**

```bash
cd apps/agent
GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -p 1 ./cmd/agent
```

Expected: no errors (requires macOS SDK — run on macOS or use cross-compilation toolchain)

- [ ] **Step 5.7: Commit**

```bash
git add apps/agent/internal/capture/permissions_darwin.go \
    apps/agent/internal/capture/permissions_windows.go \
    apps/agent/internal/capture/permissions_linux.go \
    apps/agent/cmd/agent/main.go
git commit -m "feat(agent): macOS/Windows/Linux permission check + graceful degradation"
```

---

## Task 6: Accurate Window Detection — macOS Accessibility API

Current macOS window detection misses window titles for many apps. The Accessibility API (AXUIElement) is the production approach used by all major macOS monitoring tools.

**Files:**
- Modify: `apps/agent/internal/capture/window_darwin.go`

- [ ] **Step 6.1: Rewrite macOS window detection**

```go
// apps/agent/internal/capture/window_darwin.go
//go:build darwin

package capture

/*
#cgo LDFLAGS: -framework ApplicationServices -framework AppKit
#include <ApplicationServices/ApplicationServices.h>
#include <AppKit/AppKit.h>
#include <stdlib.h>

typedef struct {
    char* app_name;
    char* window_title;
    char* bundle_id;
} WindowInfo;

WindowInfo getActiveWindow() {
    WindowInfo info = {NULL, NULL, NULL};

    // Get frontmost application
    NSRunningApplication* app = [[NSWorkspace sharedWorkspace] frontmostApplication];
    if (!app) return info;

    // App name from NSRunningApplication (always works, no permission needed)
    NSString* appName = app.localizedName ?: app.bundleIdentifier;
    info.app_name = strdup([appName UTF8String]);
    info.bundle_id = app.bundleIdentifier ? strdup([app.bundleIdentifier UTF8String]) : NULL;

    // Window title via Accessibility API (requires Accessibility permission)
    AXUIElementRef appRef = AXUIElementCreateApplication(app.processIdentifier);
    if (!appRef) return info;

    AXUIElementRef windowRef = NULL;
    AXError err = AXUIElementCopyAttributeValue(
        appRef, kAXFocusedWindowAttribute, (CFTypeRef*)&windowRef);

    if (err == kAXErrorSuccess && windowRef) {
        CFStringRef title = NULL;
        if (AXUIElementCopyAttributeValue(windowRef, kAXTitleAttribute, (CFTypeRef*)&title) == kAXErrorSuccess && title) {
            info.window_title = strdup([(NSString*)title UTF8String]);
            CFRelease(title);
        }
        CFRelease(windowRef);
    }
    CFRelease(appRef);
    return info;
}

void freeWindowInfo(WindowInfo info) {
    if (info.app_name)    free(info.app_name);
    if (info.window_title) free(info.window_title);
    if (info.bundle_id)   free(info.bundle_id);
}
*/
import "C"
import "unsafe"

// GetActiveWindow returns the frontmost application and focused window title.
// Falls back to app name only if Accessibility permission is not granted.
func GetActiveWindow() (WindowInfo, error) {
	raw := C.getActiveWindow()
	defer C.freeWindowInfo(raw)

	info := WindowInfo{}
	if raw.app_name != nil {
		info.AppName = C.GoString(raw.app_name)
	}
	if raw.window_title != nil {
		info.WindowTitle = C.GoString(raw.window_title)
	}
	if raw.bundle_id != nil {
		info.BundleID = C.GoString(raw.bundle_id)
	}
	if info.AppName == "" {
		return info, fmt.Errorf("no active window")
	}
	return info, nil
}
```

Add `BundleID string` field to `WindowInfo` struct in the shared types file (`window.go`):

```go
// apps/agent/internal/capture/window.go
package capture

// WindowInfo holds information about the active window.
type WindowInfo struct {
    AppName     string
    WindowTitle string
    URL         string
    BundleID    string // macOS only — com.apple.Safari, com.google.Chrome, etc.
}
```

- [ ] **Step 6.2: Build macOS to verify**

```bash
cd apps/agent
GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -p 1 ./cmd/agent
```

Expected: no errors

- [ ] **Step 6.3: Commit**

```bash
git add apps/agent/internal/capture/window_darwin.go apps/agent/internal/capture/window.go
git commit -m "feat(agent): macOS Accessibility API window detection (AXUIElement)"
```

---

## Task 7: 3-Layer Browser URL Detection

Browser URL detection is the most complex capture problem. Three layers in priority order:
1. Native messaging extension (exact URL, instant)
2. Accessibility API scraping (address bar text, ~200ms)
3. Window title parsing (regex, always works)

**Files:**
- Create: `apps/agent/internal/capture/browser_url.go`
- Create: `apps/agent/internal/capture/browser_url_darwin.go`
- Create: `apps/agent/internal/capture/browser_url_windows.go`
- Create: `apps/agent/internal/capture/browser_url_linux.go`

- [ ] **Step 7.1: Create URL resolver interface**

```go
// apps/agent/internal/capture/browser_url.go
package capture

import (
	"regexp"
	"strings"
	"sync/atomic"
)

// URLDetectionLayer tracks which layer last successfully resolved a URL.
// Exposed via agent telemetry for observability.
var URLDetectionLayer atomic.Int32 // 1=extension, 2=accessibility, 3=title

// knownBrowserBundles maps BundleID/process names to browser type.
var knownBrowserBundles = map[string]bool{
	"com.google.Chrome":           true,
	"com.apple.Safari":            true,
	"org.mozilla.firefox":         true,
	"com.microsoft.edgemac":       true,
	"com.brave.Browser":           true,
	"chrome":                      true,
	"msedge":                      true,
	"firefox":                     true,
}

// IsBrowser returns true if the window belongs to a known browser.
func IsBrowser(win WindowInfo) bool {
	if win.BundleID != "" {
		return knownBrowserBundles[win.BundleID]
	}
	name := strings.ToLower(win.AppName)
	return strings.Contains(name, "chrome") ||
		strings.Contains(name, "firefox") ||
		strings.Contains(name, "safari") ||
		strings.Contains(name, "edge") ||
		strings.Contains(name, "brave")
}

// ExtractURLFromTitle parses a browser window title to extract a domain.
// Layer 3 fallback — least accurate.
// Examples:
//   "GitHub - microsoft/vscode - Google Chrome" → "github.com"  (heuristic)
//   "YouTube - Mozilla Firefox" → "youtube.com" (heuristic)
func ExtractURLFromTitle(title string) string {
	// Pattern: "Page Title - Site Name - Browser Name"
	// The site name is usually the second-to-last " - " segment
	parts := strings.Split(title, " - ")
	if len(parts) < 2 {
		return ""
	}
	// Try to find a domain-like segment
	domainPattern := regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}`)
	for i := len(parts) - 2; i >= 0; i-- {
		candidate := strings.TrimSpace(parts[i])
		// Known site names → map to domain
		if domain, ok := siteNameToDomain[strings.ToLower(candidate)]; ok {
			return domain
		}
		if domainPattern.MatchString(candidate) {
			return candidate
		}
	}
	return ""
}

var siteNameToDomain = map[string]string{
	"github":    "github.com",
	"youtube":   "youtube.com",
	"google":    "google.com",
	"gmail":     "mail.google.com",
	"linkedin":  "linkedin.com",
	"twitter":   "twitter.com",
	"facebook":  "facebook.com",
	"slack":     "app.slack.com",
	"notion":    "notion.so",
	"figma":     "figma.com",
	"jira":      "atlassian.net",
}

// ResolveURL returns the best URL for the active browser window.
// Tries extension cache (Layer 1), then platform-specific AX scraping (Layer 2),
// then title parsing (Layer 3). Returns "" if not a browser window.
func ResolveURL(win WindowInfo, extensionCache string) string {
	if !IsBrowser(win) {
		return ""
	}
	// Layer 1: native messaging extension cache (set by listenBrowserURLs)
	if extensionCache != "" {
		URLDetectionLayer.Store(1)
		return extensionCache
	}
	// Layer 2: Accessibility API scraping (platform-specific)
	if url := scrapeURLViaAccessibility(win); url != "" {
		URLDetectionLayer.Store(2)
		return url
	}
	// Layer 3: window title parsing
	if url := ExtractURLFromTitle(win.WindowTitle); url != "" {
		URLDetectionLayer.Store(3)
		return url
	}
	return ""
}
```

- [ ] **Step 7.2: Write unit tests for title parser**

```go
// apps/agent/internal/capture/browser_url_test.go
package capture_test

import (
	"testing"

	"github.com/timechamp/agent/internal/capture"
)

func TestExtractURLFromTitle(t *testing.T) {
	cases := []struct {
		title    string
		expected string
	}{
		{"GitHub - microsoft/vscode - Google Chrome", "github.com"},
		{"YouTube - Mozilla Firefox", "youtube.com"},
		{"New Tab - Google Chrome", ""},
		{"notion.so - Workspace - Brave", "notion.so"},
		{"Gmail - Google Chrome", "mail.google.com"},
	}
	for _, c := range cases {
		got := capture.ExtractURLFromTitle(c.title)
		if got != c.expected {
			t.Errorf("title=%q: got %q, want %q", c.title, got, c.expected)
		}
	}
}

func TestIsBrowser(t *testing.T) {
	cases := []struct {
		win      capture.WindowInfo
		expected bool
	}{
		{capture.WindowInfo{AppName: "Google Chrome"}, true},
		{capture.WindowInfo{BundleID: "com.apple.Safari"}, true},
		{capture.WindowInfo{AppName: "Visual Studio Code"}, false},
		{capture.WindowInfo{AppName: "Slack"}, false},
	}
	for _, c := range cases {
		got := capture.IsBrowser(c.win)
		if got != c.expected {
			t.Errorf("win=%+v: got %v, want %v", c.win, got, c.expected)
		}
	}
}
```

- [ ] **Step 7.3: Run unit tests**

```bash
cd apps/agent
go test ./internal/capture/ -run "TestExtractURLFromTitle|TestIsBrowser" -v
```

Expected: all PASS

- [ ] **Step 7.4: Create macOS AX scraping (Layer 2)**

```go
// apps/agent/internal/capture/browser_url_darwin.go
//go:build darwin

package capture

/*
#cgo LDFLAGS: -framework ApplicationServices
#include <ApplicationServices/ApplicationServices.h>
#include <stdlib.h>

// Returns the text content of the browser's URL bar via AX API.
// Returns NULL if not accessible or permission not granted.
char* getBrowserURL(pid_t pid) {
    AXUIElementRef app = AXUIElementCreateApplication(pid);
    if (!app) return NULL;

    // Find the focused window
    AXUIElementRef window = NULL;
    AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, (CFTypeRef*)&window);
    if (!window) { CFRelease(app); return NULL; }

    // Find URL field — try kAXURLAttribute first, then search toolbar
    CFStringRef urlValue = NULL;
    AXUIElementCopyAttributeValue(window, kAXURLAttribute, (CFTypeRef*)&urlValue);

    if (!urlValue) {
        // Walk the UI tree to find address bar text field
        CFArrayRef children = NULL;
        AXUIElementCopyAttributeValue(window, kAXChildrenAttribute, (CFTypeRef*)&children);
        if (children) {
            for (CFIndex i = 0; i < CFArrayGetCount(children); i++) {
                AXUIElementRef child = (AXUIElementRef)CFArrayGetValueAtIndex(children, i);
                CFStringRef role = NULL;
                AXUIElementCopyAttributeValue(child, kAXRoleAttribute, (CFTypeRef*)&role);
                if (role && CFStringCompare(role, kAXTextFieldRole, 0) == kCFCompareEqualTo) {
                    AXUIElementCopyAttributeValue(child, kAXValueAttribute, (CFTypeRef*)&urlValue);
                    if (role) CFRelease(role);
                    break;
                }
                if (role) CFRelease(role);
            }
            CFRelease(children);
        }
    }

    char* result = NULL;
    if (urlValue) {
        result = strdup([(NSString*)urlValue UTF8String]);
        CFRelease(urlValue);
    }
    CFRelease(window);
    CFRelease(app);
    return result;
}
*/
import "C"
import (
	"strings"
	"unsafe"
)

func scrapeURLViaAccessibility(win WindowInfo) string {
	if !HasAccessibility() {
		return ""
	}
	// PID not available in WindowInfo on macOS — use bundle ID to find PID
	// via NSRunningApplication (already done in getActiveWindow, store PID in WindowInfo)
	// For now: return empty — Layer 3 fallback will handle it
	// TODO: add PID field to WindowInfo and pass it here
	return ""
}
```

Note: Full AX URL scraping requires passing the process PID through `WindowInfo`. Add `PID int` field to `WindowInfo` struct and populate it in `window_darwin.go` using `app.processIdentifier`.

- [ ] **Step 7.5: Create Windows UI Automation stub**

```go
// apps/agent/internal/capture/browser_url_windows.go
//go:build windows

package capture

import (
	"strings"
	"syscall"
	"unsafe"
)

// scrapeURLViaAccessibility uses Windows UI Automation to read the browser address bar.
// This is Layer 2 URL detection on Windows.
func scrapeURLViaAccessibility(win WindowInfo) string {
	// UI Automation via COM is complex to implement in pure Go.
	// Production implementation uses go-ole + UIAutomation COM interfaces.
	// For now: return empty, rely on Layer 1 (extension) and Layer 3 (title).
	// TODO: implement via github.com/go-ole/go-ole + IUIAutomation
	return ""
}
```

- [ ] **Step 7.6: Create Linux stub**

```go
// apps/agent/internal/capture/browser_url_linux.go
//go:build linux

package capture

// scrapeURLViaAccessibility on Linux uses AT-SPI (Assistive Technology Service Provider Interface).
// AT-SPI is available on GNOME/KDE desktops with accessibility enabled.
// For now: return empty, rely on Layer 1 (extension) and Layer 3 (title).
// TODO: implement via dbus AT-SPI
func scrapeURLViaAccessibility(win WindowInfo) string {
	return ""
}
```

- [ ] **Step 7.7: Wire ResolveURL into main.go window poll**

In `apps/agent/cmd/agent/main.go`, in the window poll case, replace the URL resolution block:

```go
// BEFORE:
url := win.URL
if url == "" {
    if extURL := urlCache.Load().(string); extURL != "" {
        url = extURL
    }
}

// AFTER:
extURL := urlCache.Load().(string)
url := capture.ResolveURL(win, extURL)
```

- [ ] **Step 7.8: Run all tests and build**

```bash
cd apps/agent
go test ./internal/capture/ -v
GOOS=windows GOARCH=amd64 go build -p 1 ./cmd/agent
GOOS=linux   GOARCH=amd64 go build -p 1 ./cmd/agent
```

Expected: tests PASS, builds succeed on all platforms

- [ ] **Step 7.9: Commit**

```bash
git add apps/agent/internal/capture/browser_url.go \
    apps/agent/internal/capture/browser_url_darwin.go \
    apps/agent/internal/capture/browser_url_windows.go \
    apps/agent/internal/capture/browser_url_linux.go \
    apps/agent/internal/capture/window.go \
    apps/agent/cmd/agent/main.go
git commit -m "feat(agent): 3-layer browser URL detection (extension → AX API → title parsing)"
```

---

## Task 8: Agent Self-Telemetry

The agent reports its own health metrics every 60s. This feeds the Grafana fleet dashboard.

**Files:**
- Create: `apps/agent/internal/telemetry/agent_metrics.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] **Step 8.1: Create agent metrics struct and emitter**

```go
// apps/agent/internal/telemetry/agent_metrics.go
package telemetry

import (
	"time"

	"github.com/timechamp/agent/internal/capture"
)

// AgentTelemetry is reported every 60s to /api/v1/agent/sync/telemetry.
type AgentTelemetry struct {
	AgentVersion      string  `json:"agent_version"`
	OS                string  `json:"os"`
	OrgID             string  `json:"org_id"`
	EmployeeID        string  `json:"employee_id"`
	UptimeSec         int64   `json:"uptime_sec"`
	MemUsedMB         float64 `json:"mem_used_mb"`
	CPUPercent        float64 `json:"cpu_percent"`
	LastSyncSuccess   bool    `json:"last_sync_success"`
	LastSyncLatencyMs int64   `json:"last_sync_latency_ms"`
	BufferedEvents    int     `json:"buffered_events"`
	SyncErrorCount    int     `json:"sync_error_count"`
	// Permissions
	HasScreenRecording bool `json:"has_screen_recording"`
	HasAccessibility   bool `json:"has_accessibility"`
	// URL detection
	URLDetectionLayer int32 `json:"url_detection_layer"` // 1=extension 2=AX 3=title
}

// Collector gathers agent self-metrics for reporting.
type Collector struct {
	startedAt  time.Time
	version    string
	orgID      string
	employeeID string
}

func NewCollector(version, orgID, employeeID string) *Collector {
	return &Collector{
		startedAt:  time.Now(),
		version:    version,
		orgID:      orgID,
		employeeID: employeeID,
	}
}

func (c *Collector) Collect(
	lastSyncSuccess bool,
	lastSyncLatencyMs int64,
	bufferedEvents int,
	syncErrorCount int,
) AgentTelemetry {
	m, _ := capture.GetSystemMetrics()
	return AgentTelemetry{
		AgentVersion:      c.version,
		OS:                runtime_GOOS(),
		OrgID:             c.orgID,
		EmployeeID:        c.employeeID,
		UptimeSec:         int64(time.Since(c.startedAt).Seconds()),
		MemUsedMB:         m.AgentMemMB,
		CPUPercent:        m.AgentCPUPercent,
		LastSyncSuccess:   lastSyncSuccess,
		LastSyncLatencyMs: lastSyncLatencyMs,
		BufferedEvents:    bufferedEvents,
		SyncErrorCount:    syncErrorCount,
		HasScreenRecording: capture.HasScreenRecording(),
		HasAccessibility:   capture.HasAccessibility(),
		URLDetectionLayer:  capture.URLDetectionLayer.Load(),
	}
}

func runtime_GOOS() string {
	switch {
	case isWindows():
		return "windows"
	case isDarwin():
		return "darwin"
	default:
		return "linux"
	}
}
```

Create platform stubs:

```go
// apps/agent/internal/telemetry/platform_windows.go
//go:build windows
package telemetry
func isWindows() bool { return true }
func isDarwin() bool  { return false }

// apps/agent/internal/telemetry/platform_darwin.go
//go:build darwin
package telemetry
func isWindows() bool { return false }
func isDarwin() bool  { return true }

// apps/agent/internal/telemetry/platform_linux.go
//go:build linux
package telemetry
func isWindows() bool { return false }
func isDarwin() bool  { return false }
```

- [ ] **Step 8.2: Wire telemetry emission into main.go**

Add a `telemetryTicker` every 60 seconds in the main event loop:

```go
// After existing ticker declarations:
telemetryTicker := time.NewTicker(60 * time.Second)
defer telemetryTicker.Stop()

telemetryCollector := telemetry.NewCollector(Version, cfg.OrgID, cfg.EmployeeID)
var (
    lastSyncSuccess   bool
    lastSyncLatencyMs int64
    syncErrorCount    int
)
```

In the sync flush case, update these variables:
```go
case <-syncTicker.C:
    start := time.Now()
    // ... existing flush code ...
    lastSyncLatencyMs = time.Since(start).Milliseconds()
    lastSyncSuccess = (err1 == nil && err2 == nil && err3 == nil && err4 == nil)
    if !lastSyncSuccess {
        syncErrorCount++
    }
```

In the new telemetry case:
```go
case <-telemetryTicker.C:
    if !client.IsAvailable() {
        continue
    }
    buffered, _ := db.CountUnsynced()
    t := telemetryCollector.Collect(lastSyncSuccess, lastSyncLatencyMs, buffered, syncErrorCount)
    syncErrorCount = 0 // reset counter after reporting
    _ = client.Post("/agent/sync/telemetry", t)
```

- [ ] **Step 8.3: Build all platforms**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build -p 1 ./cmd/agent
GOOS=linux   GOARCH=amd64 go build -p 1 ./cmd/agent
```

Expected: no errors

- [ ] **Step 8.4: Rebuild tray with new agent binary**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build -p 1 -ldflags="-s -w" -o cmd/tray/agent_bin.exe ./cmd/agent
cd cmd/tray
wails build -platform windows/amd64
```

Expected: `Built 'build/bin/timechamp-tray.exe'`

- [ ] **Step 8.5: Smoke test — run agent, check health endpoint**

```bash
# Start agent directly
TC_API_URL=http://localhost:3000 TC_AGENT_TOKEN=<your-token> ./timechamp-agent.exe

# In another terminal, verify health endpoint responds
curl http://127.0.0.1:27183/health
# Expected: {"status":"ok","uptime_sec":5,"version":"dev"}
```

- [ ] **Step 8.6: Commit**

```bash
git add apps/agent/internal/telemetry/ apps/agent/cmd/agent/main.go apps/agent/cmd/tray/agent_bin.exe
git commit -m "feat(agent): self-telemetry reporting (uptime, sync health, permissions, URL layer)"
```

---

## Task 9: End-to-End Verification

Verify all Phase 1 changes work together on a real machine.

- [ ] **Step 9.1: Full build for all platforms**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build -p 1 -ldflags="-s -w" -o /tmp/agent-windows.exe ./cmd/agent
GOOS=linux   GOARCH=amd64 go build -p 1 -ldflags="-s -w" -o /tmp/agent-linux   ./cmd/agent
# macOS must be built on macOS:
# GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -ldflags="-s -w" -o /tmp/agent-darwin ./cmd/agent
```

Expected: all succeed

- [ ] **Step 9.2: Run full test suite**

```bash
cd apps/agent
go test ./... -v -timeout 60s
```

Expected: all tests PASS

- [ ] **Step 9.3: Verify agent log shows no shutdown signals**

After running the new tray for 5 minutes, check:

```bash
cat "$APPDATA/TimeChamp/agent.log"
```

Expected log pattern (no "Shutdown signal received"):
```
[agent] Time Champ Agent dev (unknown) on windows/amd64
[agent] Agent started. Screenshot every 300s, sync every 30s, idle threshold 180s
[agent] Synced: N activity, 0 keystrokes, 0 screenshots, N metrics
[agent] Synced: N activity, ...
```

- [ ] **Step 9.4: Verify health endpoint responds**

```bash
curl http://127.0.0.1:27183/health
```

Expected: `{"status":"ok","uptime_sec":NNN,"version":"dev"}`

- [ ] **Step 9.5: Final commit with all Phase 1 changes**

```bash
cd apps/agent
git add -u
git commit -m "feat(agent): Phase 1 complete — reliability + permissions + accurate detection"
```
