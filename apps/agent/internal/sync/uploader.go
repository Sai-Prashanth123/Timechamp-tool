package sync

import (
	"fmt"
	"path/filepath"
	"time"

	"github.com/timechamp/agent/internal/buffer"
)

const batchSize = 100

// MetricsPayload is the JSON structure sent to the API.
type MetricsPayload struct {
	Events []MetricsEventDTO `json:"events"`
}

// MetricsEventDTO is the API wire format for one metrics snapshot.
type MetricsEventDTO struct {
	EmployeeID      string    `json:"employeeId"`
	OrgID           string    `json:"orgId"`
	CPUPercent      float64   `json:"cpuPercent"`
	MemUsedMB       uint64    `json:"memUsedMb"`
	MemTotalMB      uint64    `json:"memTotalMb"`
	AgentCPUPercent float64   `json:"agentCpuPercent"`
	AgentMemMB      uint64    `json:"agentMemMb"`
	RecordedAt      time.Time `json:"recordedAt"`
}

// Uploader flushes the local SQLite buffer to the TimeChamp API.
type Uploader struct {
	client *Client
	db     *buffer.DB
}

// NewUploader creates a new Uploader.
func NewUploader(client *Client, db *buffer.DB) *Uploader {
	return &Uploader{client: client, db: db}
}

// ActivityPayload is the JSON structure sent to the API.
type ActivityPayload struct {
	Events []ActivityEventDTO `json:"events"`
}

// ActivityEventDTO is the API wire format for one activity event.
type ActivityEventDTO struct {
	EmployeeID  string    `json:"employeeId"`
	OrgID       string    `json:"orgId"`
	AppName     string    `json:"appName"`
	WindowTitle string    `json:"windowTitle"`
	URL         string    `json:"url"`
	Category    string    `json:"category"`
	DurationMs  int64     `json:"durationMs"`
	StartedAt   time.Time `json:"startedAt"`
	EndedAt     time.Time `json:"endedAt"`
}

// KeystrokePayload is the JSON structure sent to the API.
type KeystrokePayload struct {
	Events []KeystrokeEventDTO `json:"events"`
}

// KeystrokeEventDTO is the API wire format for one keystroke record.
type KeystrokeEventDTO struct {
	EmployeeID  string    `json:"employeeId"`
	OrgID       string    `json:"orgId"`
	KeysPerMin  int       `json:"keysPerMin"`
	MousePerMin int       `json:"mousePerMin"`
	RecordedAt  time.Time `json:"recordedAt"`
}

// FlushActivity uploads all unsynced activity events and removes them from the buffer.
// Returns the number of events flushed.
func (u *Uploader) FlushActivity() (int, error) {
	if !u.client.IsAvailable() {
		return 0, fmt.Errorf("API unavailable (circuit open)")
	}

	events, err := u.db.ListUnsyncedActivity(batchSize)
	if err != nil {
		return 0, fmt.Errorf("list activity: %w", err)
	}
	if len(events) == 0 {
		return 0, nil
	}

	payload := ActivityPayload{}
	ids := make([]int64, 0, len(events))
	for _, e := range events {
		payload.Events = append(payload.Events, ActivityEventDTO{
			EmployeeID:  e.EmployeeID,
			OrgID:       e.OrgID,
			AppName:     e.AppName,
			WindowTitle: e.WindowTitle,
			URL:         e.URL,
			Category:    e.Category,
			DurationMs:  e.DurationMs,
			StartedAt:   e.StartedAt,
			EndedAt:     e.EndedAt,
		})
		ids = append(ids, e.ID)
	}

	if err := u.client.Post("/agent/activity", payload); err != nil {
		return 0, fmt.Errorf("upload activity: %w", err)
	}

	if err := u.db.MarkActivitySynced(ids); err != nil {
		return 0, fmt.Errorf("mark synced: %w", err)
	}

	return len(events), nil
}

// FlushKeystrokes uploads all unsynced keystroke records.
func (u *Uploader) FlushKeystrokes() (int, error) {
	if !u.client.IsAvailable() {
		return 0, nil
	}

	events, err := u.db.ListUnsyncedKeystrokes(batchSize)
	if err != nil {
		return 0, err
	}
	if len(events) == 0 {
		return 0, nil
	}

	payload := KeystrokePayload{}
	ids := make([]int64, 0, len(events))
	for _, e := range events {
		payload.Events = append(payload.Events, KeystrokeEventDTO{
			EmployeeID:  e.EmployeeID,
			OrgID:       e.OrgID,
			KeysPerMin:  e.KeysPerMin,
			MousePerMin: e.MousePerMin,
			RecordedAt:  e.RecordedAt,
		})
		ids = append(ids, e.ID)
	}

	if err := u.client.Post("/agent/keystrokes", payload); err != nil {
		return 0, err
	}

	return len(events), u.db.MarkKeystrokesSynced(ids)
}

// FlushMetrics uploads all unsynced system metrics snapshots.
func (u *Uploader) FlushMetrics() (int, error) {
	if !u.client.IsAvailable() {
		return 0, nil
	}

	events, err := u.db.ListUnsyncedMetrics(batchSize)
	if err != nil {
		return 0, err
	}
	if len(events) == 0 {
		return 0, nil
	}

	payload := MetricsPayload{}
	ids := make([]int64, 0, len(events))
	for _, e := range events {
		payload.Events = append(payload.Events, MetricsEventDTO{
			EmployeeID:      e.EmployeeID,
			OrgID:           e.OrgID,
			CPUPercent:      e.CPUPercent,
			MemUsedMB:       e.MemUsedMB,
			MemTotalMB:      e.MemTotalMB,
			AgentCPUPercent: e.AgentCPUPercent,
			AgentMemMB:      e.AgentMemMB,
			RecordedAt:      e.RecordedAt,
		})
		ids = append(ids, e.ID)
	}

	if err := u.client.Post("/agent/metrics", payload); err != nil {
		return 0, err
	}

	return len(events), u.db.MarkMetricsSynced(ids)
}

// FlushScreenshots uploads all unsynced screenshots via presigned S3 URLs.
func (u *Uploader) FlushScreenshots() (int, error) {
	if !u.client.IsAvailable() {
		return 0, nil
	}

	records, err := u.db.ListUnsyncedScreenshots(10) // smaller batch for large files
	if err != nil {
		return 0, err
	}

	flushed := 0
	for _, r := range records {
		filename := filepath.Base(r.LocalPath)
		uploadURL, s3Key, err := u.client.GetPresignedUploadURL(filename)
		if err != nil {
			continue // skip this screenshot, try next
		}

		if err := uploadFileToS3(u.client, r.LocalPath, uploadURL); err != nil {
			continue
		}

		if err := u.db.MarkScreenshotSynced(r.ID, s3Key); err != nil {
			continue
		}
		flushed++
	}

	return flushed, nil
}
