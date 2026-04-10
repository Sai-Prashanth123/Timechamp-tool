package buffer

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite connection for the local event buffer.
type DB struct {
	conn          *sql.DB
	DroppedEvents atomic.Uint64 // count of events dropped due to disk-full or WAL cap
}

// Open opens (or creates) the SQLite database in dir.
func Open(dir string) (*DB, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	path := filepath.Join(dir, "buffer.db")
	conn, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	conn.SetMaxOpenConns(1) // SQLite is single-writer

	// Cap WAL file at 64 MB and auto-checkpoint every 1000 pages (~4 MB).
	// Prevents unbounded WAL growth on long-running agents.
	conn.Exec(`PRAGMA journal_size_limit=67108864`) //nolint:errcheck
	conn.Exec(`PRAGMA wal_autocheckpoint=200`)      //nolint:errcheck // ~800KB trigger

	db := &DB{conn: conn}
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return db, nil
}

// Close closes the underlying database connection.
func (db *DB) Close() error {
	return db.conn.Close()
}

// Checkpoint forces a WAL checkpoint, truncating the WAL file.
// Call this daily or on graceful shutdown to reclaim disk space.
// A 10-second timeout prevents checkpoint from blocking indefinitely on
// a locked WAL (e.g. during a crash or slow reader).
func (db *DB) Checkpoint() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := db.conn.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}

func (db *DB) migrate() error {
	// Check schema version — bail out if already migrated.
	var version int
	db.conn.QueryRow(`PRAGMA user_version`).Scan(&version) //nolint:errcheck
	if version >= 1 {
		return nil
	}

	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS activity_events (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			employee_id  TEXT NOT NULL,
			org_id       TEXT NOT NULL,
			app_name     TEXT NOT NULL,
			window_title TEXT NOT NULL,
			url          TEXT NOT NULL DEFAULT '',
			category     TEXT NOT NULL DEFAULT '',
			duration_ms  INTEGER NOT NULL DEFAULT 0,
			started_at   DATETIME NOT NULL,
			ended_at     DATETIME NOT NULL,
			synced       INTEGER NOT NULL DEFAULT 0,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS screenshots (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			employee_id  TEXT NOT NULL,
			org_id       TEXT NOT NULL,
			local_path   TEXT NOT NULL,
			s3_key       TEXT NOT NULL DEFAULT '',
			captured_at  DATETIME NOT NULL,
			synced       INTEGER NOT NULL DEFAULT 0,
			created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS keystroke_events (
			id              INTEGER PRIMARY KEY AUTOINCREMENT,
			employee_id     TEXT NOT NULL,
			org_id          TEXT NOT NULL,
			keys_per_min    INTEGER NOT NULL DEFAULT 0,
			mouse_per_min   INTEGER NOT NULL DEFAULT 0,
			recorded_at     DATETIME NOT NULL,
			synced          INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE IF NOT EXISTS system_metrics (
			id                INTEGER PRIMARY KEY AUTOINCREMENT,
			employee_id        TEXT NOT NULL,
			org_id             TEXT NOT NULL,
			cpu_percent        REAL NOT NULL DEFAULT 0,
			mem_used_mb        INTEGER NOT NULL DEFAULT 0,
			mem_total_mb       INTEGER NOT NULL DEFAULT 0,
			agent_cpu_percent  REAL NOT NULL DEFAULT 0,
			agent_mem_mb       INTEGER NOT NULL DEFAULT 0,
			recorded_at        DATETIME NOT NULL,
			synced             INTEGER NOT NULL DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_activity_synced ON activity_events(synced);
		CREATE INDEX IF NOT EXISTS idx_screenshots_synced ON screenshots(synced);
		CREATE INDEX IF NOT EXISTS idx_keystrokes_synced ON keystroke_events(synced);
		CREATE INDEX IF NOT EXISTS idx_metrics_synced ON system_metrics(synced);
	`)
	if err != nil {
		return err
	}
	// Stamp schema version so future migrations can detect upgrades.
	_, err = db.conn.Exec(`PRAGMA user_version = 1`)
	return err
}

// CapBuffer trims the oldest unsynced rows from each table so that no table
// exceeds its per-table limit. Screenshots use maxRows/5 because they are large.
// The first error encountered is returned; subsequent tables are still processed.
func (db *DB) CapBuffer(maxRows int) error {
	type tableLimit struct {
		table string
		limit int
	}
	screenshotLimit := max(maxRows/5, 1)
	tables := []tableLimit{
		{"activity_events", maxRows},
		{"screenshots", screenshotLimit},
		{"keystroke_events", maxRows},
		{"system_metrics", maxRows},
	}

	var firstErr error
	for _, tl := range tables {
		var count int
		row := db.conn.QueryRow(
			fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE synced = 0`, tl.table),
		)
		if err := row.Scan(&count); err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("cap buffer count %s: %w", tl.table, err)
			}
			continue
		}
		overflow := count - tl.limit
		if overflow <= 0 {
			continue
		}
		_, err := db.conn.Exec(fmt.Sprintf(
			`DELETE FROM %s WHERE id IN (SELECT id FROM %s WHERE synced = 0 ORDER BY id ASC LIMIT %d)`,
			tl.table, tl.table, overflow,
		))
		if err != nil && firstErr == nil {
			firstErr = fmt.Errorf("cap buffer trim %s: %w", tl.table, err)
		}
	}
	return firstErr
}

// CountAll returns the number of unsynced rows in each of the four buffer tables.
// Map keys: "activity", "screenshots", "keystrokes", "metrics".
func (db *DB) CountAll() (map[string]int, error) {
	type tableKey struct {
		table string
		key   string
	}
	tables := []tableKey{
		{"activity_events", "activity"},
		{"screenshots", "screenshots"},
		{"keystroke_events", "keystrokes"},
		{"system_metrics", "metrics"},
	}

	counts := make(map[string]int, len(tables))
	for _, tk := range tables {
		var n int
		row := db.conn.QueryRow(
			fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE synced = 0`, tk.table),
		)
		if err := row.Scan(&n); err != nil {
			return counts, fmt.Errorf("count %s: %w", tk.table, err)
		}
		counts[tk.key] = n
	}
	return counts, nil
}

// InsertActivityBatch inserts multiple activity events in a single transaction.
// Using a prepared statement executed N times within one transaction is ~100x
// faster than N individual Exec calls because the WAL gets one fsync per batch.
func (db *DB) InsertActivityBatch(events []ActivityEvent) error {
	if len(events) == 0 {
		return nil
	}
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO activity_events
		(employee_id, org_id, app_name, window_title, url, category, duration_ms, started_at, ended_at)
		VALUES (?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback() //nolint:errcheck
		return err
	}
	defer stmt.Close()
	for _, e := range events {
		if _, err := stmt.Exec(
			e.EmployeeID, e.OrgID, e.AppName, e.WindowTitle,
			e.URL, e.Category, e.DurationMs,
			e.StartedAt.UTC(), e.EndedAt.UTC(),
		); err != nil {
			tx.Rollback() //nolint:errcheck
			return err
		}
	}
	return tx.Commit()
}

// IsDiskFull returns true when err indicates the host filesystem or SQLite
// database has no space left. Use this to emit a clear operator warning
// instead of logging a cryptic sqlite error code.
func IsDiskFull(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "disk full") ||
		strings.Contains(msg, "no space left") ||
		strings.Contains(msg, "sqlite_full") ||
		strings.Contains(msg, "database or disk is full")
}
