package buffer

import (
	"testing"
	"time"
)

func TestWriteBatcherFlushOnWindow(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	b := NewWriteBatcher(db, 50*time.Millisecond, 200)
	b.Add(ActivityEvent{
		EmployeeID: "e1", OrgID: "o1", AppName: "Chrome",
		StartedAt: time.Now(), EndedAt: time.Now().Add(time.Second), DurationMs: 1000,
	})

	time.Sleep(100 * time.Millisecond) // wait for timer flush

	events, err := db.ListUnsyncedActivity(10)
	if err != nil {
		t.Fatalf("ListUnsyncedActivity: %v", err)
	}
	if len(events) != 1 {
		t.Errorf("expected 1 event after timer flush, got %d", len(events))
	}
}

func TestWriteBatcherFlushOnCap(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	b := NewWriteBatcher(db, 10*time.Second, 3) // cap of 3
	for i := range 3 {
		b.Add(ActivityEvent{
			EmployeeID: "e1", OrgID: "o1", AppName: "App",
			StartedAt: time.Now(), EndedAt: time.Now().Add(time.Second),
			DurationMs: int64(i * 1000),
		})
	}
	// At 3 events the batcher flushes immediately without waiting for the timer.
	events, err := db.ListUnsyncedActivity(10)
	if err != nil {
		t.Fatalf("ListUnsyncedActivity: %v", err)
	}
	if len(events) != 3 {
		t.Errorf("expected 3 events after cap flush, got %d", len(events))
	}
}

func TestWriteBatcherExplicitFlush(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	b := NewWriteBatcher(db, 10*time.Second, 200) // large cap, long window
	b.Add(ActivityEvent{
		EmployeeID: "e1", OrgID: "o1", AppName: "Code",
		StartedAt: time.Now(), EndedAt: time.Now().Add(time.Second), DurationMs: 1000,
	})

	// Events should not be in DB yet.
	events, _ := db.ListUnsyncedActivity(10)
	if len(events) != 0 {
		t.Errorf("expected 0 events before explicit flush, got %d", len(events))
	}

	b.Flush()

	events, _ = db.ListUnsyncedActivity(10)
	if len(events) != 1 {
		t.Errorf("expected 1 event after explicit flush, got %d", len(events))
	}
}
