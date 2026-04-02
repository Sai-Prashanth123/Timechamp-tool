package buffer_test

import (
	"os"
	"testing"
	"time"

	"github.com/timechamp/agent/internal/buffer"
)

func setupTestDB(t *testing.T) (*buffer.DB, func()) {
	t.Helper()
	dir := t.TempDir()
	db, err := buffer.Open(dir)
	if err != nil {
		t.Fatalf("Open() error: %v", err)
	}
	return db, func() {
		db.Close()
		os.RemoveAll(dir)
	}
}

func TestInsertAndListActivity(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	event := buffer.ActivityEvent{
		EmployeeID:  "emp-123",
		OrgID:       "org-456",
		AppName:     "Visual Studio Code",
		WindowTitle: "main.go — timechamp",
		StartedAt:   time.Now().Add(-10 * time.Minute),
		EndedAt:     time.Now(),
	}

	if err := db.InsertActivity(event); err != nil {
		t.Fatalf("InsertActivity() error: %v", err)
	}

	events, err := db.ListUnsyncedActivity(100)
	if err != nil {
		t.Fatalf("ListUnsyncedActivity() error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].AppName != "Visual Studio Code" {
		t.Errorf("expected AppName %q, got %q", "Visual Studio Code", events[0].AppName)
	}
}

func TestMarkActivitySynced(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	event := buffer.ActivityEvent{
		EmployeeID:  "emp-123",
		OrgID:       "org-456",
		AppName:     "Chrome",
		WindowTitle: "Google",
		StartedAt:   time.Now().Add(-5 * time.Minute),
		EndedAt:     time.Now(),
	}
	if err := db.InsertActivity(event); err != nil {
		t.Fatal(err)
	}

	events, _ := db.ListUnsyncedActivity(100)
	if len(events) != 1 {
		t.Fatalf("expected 1 unsynced event before marking")
	}

	ids := []int64{events[0].ID}
	if err := db.MarkActivitySynced(ids); err != nil {
		t.Fatalf("MarkActivitySynced() error: %v", err)
	}

	after, _ := db.ListUnsyncedActivity(100)
	if len(after) != 0 {
		t.Errorf("expected 0 unsynced events after marking, got %d", len(after))
	}
}

func TestInsertAndListScreenshots(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	ss := buffer.ScreenshotRecord{
		EmployeeID: "emp-123",
		OrgID:      "org-456",
		LocalPath:  "/tmp/ss_001.jpg",
		CapturedAt: time.Now(),
	}

	if err := db.InsertScreenshot(ss); err != nil {
		t.Fatalf("InsertScreenshot() error: %v", err)
	}

	records, err := db.ListUnsyncedScreenshots(100)
	if err != nil {
		t.Fatalf("ListUnsyncedScreenshots() error: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 screenshot, got %d", len(records))
	}
	if records[0].LocalPath != "/tmp/ss_001.jpg" {
		t.Errorf("expected LocalPath %q, got %q", "/tmp/ss_001.jpg", records[0].LocalPath)
	}
}

func TestPruneOldRecords(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	old := buffer.ActivityEvent{
		EmployeeID:  "emp-123",
		OrgID:       "org-456",
		AppName:     "OldApp",
		WindowTitle: "Old Window",
		StartedAt:   time.Now().Add(-8 * 24 * time.Hour),
		EndedAt:     time.Now().Add(-8 * 24 * time.Hour),
		Synced:      true,
	}
	if err := db.InsertActivity(old); err != nil {
		t.Fatal(err)
	}

	if err := db.PruneSynced(7); err != nil {
		t.Fatalf("PruneSynced() error: %v", err)
	}

	count, err := db.CountActivity()
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Errorf("expected 0 records after prune, got %d", count)
	}
}
