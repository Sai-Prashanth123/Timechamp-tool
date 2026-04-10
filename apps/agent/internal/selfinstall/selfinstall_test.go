package selfinstall

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaitForHealth_SucceedsImmediately(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	old := getHealthURL
	getHealthURL = func() string { return srv.URL }
	defer func() { getHealthURL = old }()

	if err := waitForHealth(2 * time.Second); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

func TestWaitForHealth_RetriesUntilReady(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	old := getHealthURL
	getHealthURL = func() string { return srv.URL }
	defer func() { getHealthURL = old }()

	if err := waitForHealth(5 * time.Second); err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if calls < 3 {
		t.Fatalf("expected at least 3 calls, got %d", calls)
	}
}

func TestWaitForHealth_TimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	old := getHealthURL
	getHealthURL = func() string { return srv.URL }
	defer func() { getHealthURL = old }()

	if err := waitForHealth(1200 * time.Millisecond); err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestSendProgress_NilChannelDoesNotPanic(t *testing.T) {
	// Must not block or panic.
	sendProgress(nil, "hello")
}

func TestSendProgress_DeliversMessage(t *testing.T) {
	ch := make(chan string, 1)
	sendProgress(ch, "step complete")
	if got := <-ch; got != "step complete" {
		t.Fatalf("got %q", got)
	}
}
