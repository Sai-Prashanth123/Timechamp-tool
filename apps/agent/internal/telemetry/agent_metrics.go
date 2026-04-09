package telemetry

import (
	"runtime"
	"time"

	"github.com/timechamp/agent/internal/capture"
)

// AgentTelemetry is reported every 60s to /api/v1/agent/sync/telemetry.
type AgentTelemetry struct {
	AgentVersion       string  `json:"agent_version"`
	OS                 string  `json:"os"`
	OrgID              string  `json:"org_id"`
	EmployeeID         string  `json:"employee_id"`
	UptimeSec          int64   `json:"uptime_sec"`
	MemUsedMB          float64 `json:"mem_used_mb"`
	CPUPercent         float64 `json:"cpu_percent"`
	LastSyncSuccess    bool    `json:"last_sync_success"`
	LastSyncLatencyMs  int64   `json:"last_sync_latency_ms"`
	BufferedEvents     int     `json:"buffered_events"`
	SyncErrorCount     int     `json:"sync_error_count"`
	HasScreenRecording bool    `json:"has_screen_recording"`
	HasAccessibility   bool    `json:"has_accessibility"`
	URLDetectionLayer  int32   `json:"url_detection_layer"`
}

// Collector gathers agent self-metrics for reporting.
type Collector struct {
	startedAt  time.Time
	version    string
	orgID      string
	employeeID string
}

// NewCollector returns a Collector initialised at the current time.
func NewCollector(version, orgID, employeeID string) *Collector {
	return &Collector{
		startedAt:  time.Now(),
		version:    version,
		orgID:      orgID,
		employeeID: employeeID,
	}
}

// Collect samples current system metrics and returns a populated AgentTelemetry.
func (c *Collector) Collect(
	lastSyncSuccess bool,
	lastSyncLatencyMs int64,
	bufferedEvents int,
	syncErrorCount int,
) AgentTelemetry {
	m, _ := capture.GetSystemMetrics()
	return AgentTelemetry{
		AgentVersion:       c.version,
		OS:                 runtime.GOOS,
		OrgID:              c.orgID,
		EmployeeID:         c.employeeID,
		UptimeSec:          int64(time.Since(c.startedAt).Seconds()),
		MemUsedMB:          float64(m.AgentMemMB),
		CPUPercent:         m.AgentCPUPercent,
		LastSyncSuccess:    lastSyncSuccess,
		LastSyncLatencyMs:  lastSyncLatencyMs,
		BufferedEvents:     bufferedEvents,
		SyncErrorCount:     syncErrorCount,
		HasScreenRecording: capture.HasScreenRecording(),
		HasAccessibility:   capture.HasAccessibility(),
		URLDetectionLayer:  capture.URLDetectionLayer.Load(),
	}
}
