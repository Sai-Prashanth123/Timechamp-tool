package buffer

import (
	"fmt"
	"strings"
	"time"
)

// ActivityEvent represents one application usage period.
type ActivityEvent struct {
	ID          int64
	EmployeeID  string
	OrgID       string
	AppName     string
	WindowTitle string
	URL         string
	Category    string        // e.g. "Work.Development", "Leisure.Video"
	DurationMs  int64         // Accurate duration from heartbeat merge (ms)
	StartedAt   time.Time
	EndedAt     time.Time
	Synced      bool
}

// ScreenshotRecord represents a captured screenshot pending upload.
type ScreenshotRecord struct {
	ID         int64
	EmployeeID string
	OrgID      string
	LocalPath  string
	S3Key      string
	CapturedAt time.Time
	Synced     bool
}

// KeystrokeEvent represents per-minute input intensity.
type KeystrokeEvent struct {
	ID          int64
	EmployeeID  string
	OrgID       string
	KeysPerMin  int
	MousePerMin int
	RecordedAt  time.Time
	Synced      bool
}

// InsertActivity stores an activity event in the local buffer.
func (db *DB) InsertActivity(e ActivityEvent) error {
	_, err := db.conn.Exec(
		`INSERT INTO activity_events
		 (employee_id, org_id, app_name, window_title, url, category, duration_ms, started_at, ended_at, synced)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		e.EmployeeID, e.OrgID, e.AppName, e.WindowTitle, e.URL,
		e.Category, e.DurationMs,
		e.StartedAt.UTC(), e.EndedAt.UTC(), boolToInt(e.Synced),
	)
	return err
}

// ListUnsyncedActivity returns up to limit unsynced activity events.
func (db *DB) ListUnsyncedActivity(limit int) ([]ActivityEvent, error) {
	rows, err := db.conn.Query(
		`SELECT id, employee_id, org_id, app_name, window_title, url, category, duration_ms, started_at, ended_at
		 FROM activity_events WHERE synced = 0 ORDER BY id ASC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []ActivityEvent
	for rows.Next() {
		var e ActivityEvent
		if err := rows.Scan(&e.ID, &e.EmployeeID, &e.OrgID, &e.AppName, &e.WindowTitle,
			&e.URL, &e.Category, &e.DurationMs, &e.StartedAt, &e.EndedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// MarkActivitySynced deletes the given activity event IDs in a single statement.
// Using one DELETE…IN(…) instead of N individual deletes is atomic — either all
// rows are removed or none are, preventing partial syncs on DB errors.
func (db *DB) MarkActivitySynced(ids []int64) error {
	return deleteByIDs(db, "activity_events", ids)
}

// CountActivity returns the total number of activity records.
func (db *DB) CountActivity() (int, error) {
	var count int
	err := db.conn.QueryRow(`SELECT COUNT(*) FROM activity_events`).Scan(&count)
	return count, err
}

// InsertScreenshot stores a screenshot record in the local buffer.
func (db *DB) InsertScreenshot(s ScreenshotRecord) error {
	_, err := db.conn.Exec(
		`INSERT INTO screenshots (employee_id, org_id, local_path, s3_key, captured_at, synced)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		s.EmployeeID, s.OrgID, s.LocalPath, s.S3Key, s.CapturedAt.UTC(), boolToInt(s.Synced),
	)
	return err
}

// ListUnsyncedScreenshots returns up to limit unsynced screenshot records.
func (db *DB) ListUnsyncedScreenshots(limit int) ([]ScreenshotRecord, error) {
	rows, err := db.conn.Query(
		`SELECT id, employee_id, org_id, local_path, s3_key, captured_at
		 FROM screenshots WHERE synced = 0 ORDER BY id ASC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []ScreenshotRecord
	for rows.Next() {
		var r ScreenshotRecord
		if err := rows.Scan(&r.ID, &r.EmployeeID, &r.OrgID, &r.LocalPath, &r.S3Key, &r.CapturedAt); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, rows.Err()
}

// MarkScreenshotSynced deletes the screenshot record (it's been uploaded).
func (db *DB) MarkScreenshotSynced(id int64, s3Key string) error {
	_, err := db.conn.Exec(`DELETE FROM screenshots WHERE id = ?`, id)
	return err
}

// InsertKeystroke stores a keystroke intensity record.
func (db *DB) InsertKeystroke(e KeystrokeEvent) error {
	_, err := db.conn.Exec(
		`INSERT INTO keystroke_events (employee_id, org_id, keys_per_min, mouse_per_min, recorded_at, synced)
		 VALUES (?, ?, ?, ?, ?, 0)`,
		e.EmployeeID, e.OrgID, e.KeysPerMin, e.MousePerMin, e.RecordedAt.UTC(),
	)
	return err
}

// ListUnsyncedKeystrokes returns up to limit unsynced keystroke records.
func (db *DB) ListUnsyncedKeystrokes(limit int) ([]KeystrokeEvent, error) {
	rows, err := db.conn.Query(
		`SELECT id, employee_id, org_id, keys_per_min, mouse_per_min, recorded_at
		 FROM keystroke_events WHERE synced = 0 ORDER BY id ASC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []KeystrokeEvent
	for rows.Next() {
		var e KeystrokeEvent
		if err := rows.Scan(&e.ID, &e.EmployeeID, &e.OrgID, &e.KeysPerMin, &e.MousePerMin, &e.RecordedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// MarkKeystrokesSynced deletes the given keystroke record IDs atomically.
func (db *DB) MarkKeystrokesSynced(ids []int64) error {
	return deleteByIDs(db, "keystroke_events", ids)
}

// SystemMetricsEvent is a point-in-time resource snapshot.
type SystemMetricsEvent struct {
	ID              int64
	EmployeeID      string
	OrgID           string
	CPUPercent      float64
	MemUsedMB       uint64
	MemTotalMB      uint64
	AgentCPUPercent float64
	AgentMemMB      uint64
	RecordedAt      time.Time
	Synced          bool
}

// InsertMetrics stores a system metrics snapshot.
func (db *DB) InsertMetrics(e SystemMetricsEvent) error {
	_, err := db.conn.Exec(
		`INSERT INTO system_metrics (employee_id, org_id, cpu_percent, mem_used_mb, mem_total_mb, agent_cpu_percent, agent_mem_mb, recorded_at, synced)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
		e.EmployeeID, e.OrgID, e.CPUPercent, e.MemUsedMB, e.MemTotalMB,
		e.AgentCPUPercent, e.AgentMemMB, e.RecordedAt.UTC(),
	)
	return err
}

// ListUnsyncedMetrics returns up to limit unsynced metrics records.
func (db *DB) ListUnsyncedMetrics(limit int) ([]SystemMetricsEvent, error) {
	rows, err := db.conn.Query(
		`SELECT id, employee_id, org_id, cpu_percent, mem_used_mb, mem_total_mb, agent_cpu_percent, agent_mem_mb, recorded_at
		 FROM system_metrics WHERE synced = 0 ORDER BY id ASC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []SystemMetricsEvent
	for rows.Next() {
		var e SystemMetricsEvent
		if err := rows.Scan(&e.ID, &e.EmployeeID, &e.OrgID, &e.CPUPercent,
			&e.MemUsedMB, &e.MemTotalMB, &e.AgentCPUPercent, &e.AgentMemMB, &e.RecordedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// MarkMetricsSynced deletes the given metrics record IDs atomically.
func (db *DB) MarkMetricsSynced(ids []int64) error {
	return deleteByIDs(db, "system_metrics", ids)
}

// deleteByIDs deletes all rows with the given IDs from table in a single
// atomic statement. Building one DELETE…IN(?) is both faster and safer than N
// individual deletes: either all rows go or none do, preventing partial syncs.
func deleteByIDs(db *DB, table string, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1] // trim trailing comma
	query := fmt.Sprintf("DELETE FROM %s WHERE id IN (%s)", table, placeholders)
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	_, err := db.conn.Exec(query, args...)
	return err
}

// PruneSynced removes records older than maxDays days that have already been
// synced (deleted) or are too old to be useful. Since synced records are
// deleted immediately, this removes old unsynced records that can no longer
// be sent (e.g., after prolonged offline period).
func (db *DB) PruneSynced(maxDays int) error {
	cutoff := time.Now().UTC().AddDate(0, 0, -maxDays)
	queries := []struct{ table, col string }{
		{"activity_events", "started_at"},
		{"screenshots", "captured_at"},
		{"keystroke_events", "recorded_at"},
		{"system_metrics", "recorded_at"},
	}
	for _, q := range queries {
		_, err := db.conn.Exec(
			`DELETE FROM `+q.table+` WHERE `+q.col+` < ?`, cutoff,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
