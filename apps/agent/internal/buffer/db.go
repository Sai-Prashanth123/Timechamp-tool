package buffer

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite connection for the local event buffer.
type DB struct {
	conn *sql.DB
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

func (db *DB) migrate() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS activity_events (
			id           INTEGER PRIMARY KEY AUTOINCREMENT,
			employee_id  TEXT NOT NULL,
			org_id       TEXT NOT NULL,
			app_name     TEXT NOT NULL,
			window_title TEXT NOT NULL,
			url          TEXT NOT NULL DEFAULT '',
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
	return err
}
