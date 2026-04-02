package sync_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/timechamp/agent/internal/buffer"
	agentsync "github.com/timechamp/agent/internal/sync"
)

func TestUploader_FlushActivity_Success(t *testing.T) {
	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/agent/activity" && r.Method == http.MethodPost {
			var err error
			receivedBody = make([]byte, r.ContentLength)
			_, err = r.Body.Read(receivedBody)
			_ = err
			w.WriteHeader(http.StatusCreated)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	db, err := buffer.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	defer os.RemoveAll(dir)

	_ = db.InsertActivity(buffer.ActivityEvent{
		EmployeeID:  "emp-1",
		OrgID:       "org-1",
		AppName:     "Code",
		WindowTitle: "test.go",
		StartedAt:   time.Now().Add(-1 * time.Minute),
		EndedAt:     time.Now(),
	})

	client := agentsync.NewClient(server.URL+"/api/v1", "test-token")
	uploader := agentsync.NewUploader(client, db)

	flushed, err := uploader.FlushActivity()
	if err != nil {
		t.Fatalf("FlushActivity() error: %v", err)
	}
	if flushed != 1 {
		t.Errorf("expected 1 flushed, got %d", flushed)
	}

	// Verify record was deleted from buffer
	remaining, _ := db.ListUnsyncedActivity(100)
	if len(remaining) != 0 {
		t.Errorf("expected 0 remaining, got %d", len(remaining))
	}
}

func TestUploader_FlushActivity_ServerError_RetainsBuffer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	dir := t.TempDir()
	db, _ := buffer.Open(dir)
	defer db.Close()
	defer os.RemoveAll(dir)

	_ = db.InsertActivity(buffer.ActivityEvent{
		EmployeeID: "emp-1", OrgID: "org-1",
		AppName: "Code", WindowTitle: "test",
		StartedAt: time.Now().Add(-1 * time.Minute), EndedAt: time.Now(),
	})

	client := agentsync.NewClient(server.URL+"/api/v1", "test-token")
	uploader := agentsync.NewUploader(client, db)

	_, err := uploader.FlushActivity()
	if err == nil {
		t.Error("expected error on server 500, got nil")
	}

	// Buffer must be intact — no data lost
	remaining, _ := db.ListUnsyncedActivity(100)
	if len(remaining) != 1 {
		t.Errorf("expected 1 retained record on error, got %d", len(remaining))
	}
}
