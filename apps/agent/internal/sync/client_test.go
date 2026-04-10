package sync

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestResetCircuit_ClearsOpenBreaker(t *testing.T) {
	// Manually open the circuit breaker.
	c := NewClient("http://localhost", "tok")
	c.failures = 3
	c.circuitOpen = true
	c.openedAt = time.Now()

	c.ResetCircuit()

	if c.circuitOpen {
		t.Error("expected circuitOpen to be false after ResetCircuit")
	}
	if c.failures != 0 {
		t.Errorf("expected failures=0, got %d", c.failures)
	}
	if !c.IsAvailable() {
		t.Error("expected IsAvailable()=true after ResetCircuit")
	}
}

func TestResetCircuit_NoopWhenAlreadyClosed(t *testing.T) {
	c := NewClient("http://localhost", "tok")
	// Circuit already closed — ResetCircuit should be a no-op (no panic, no state change).
	c.ResetCircuit()

	if c.circuitOpen {
		t.Error("expected circuitOpen to remain false")
	}
	if c.failures != 0 {
		t.Errorf("expected failures=0, got %d", c.failures)
	}
}

func TestPostBestEffort_DoesNotTripCircuit(t *testing.T) {
	// Server that always returns 500.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	for range 5 {
		c.PostBestEffort("/test", struct{}{})
	}

	if c.circuitOpen {
		t.Error("PostBestEffort must not trip the circuit breaker")
	}
	if c.failures != 0 {
		t.Errorf("PostBestEffort must not increment failure counter, got failures=%d", c.failures)
	}
}
