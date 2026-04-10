package sync

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestResetCircuit_ClearsOpenBreaker(t *testing.T) {
	// Manually open the circuit breaker.
	c := NewClient("http://localhost", "tok")
	c.mu.Lock()
	c.failures = 3
	c.state = stateOpen
	c.openedAt = time.Now()
	c.resetTimeout = circuitResetAfter
	c.mu.Unlock()

	c.ResetCircuit()

	c.mu.Lock()
	st := c.state
	f := c.failures
	c.mu.Unlock()

	if st != stateClosed {
		t.Error("expected state=closed after ResetCircuit")
	}
	if f != 0 {
		t.Errorf("expected failures=0, got %d", f)
	}
	if !c.IsAvailable() {
		t.Error("expected IsAvailable()=true after ResetCircuit")
	}
}

func TestResetCircuit_NoopWhenAlreadyClosed(t *testing.T) {
	c := NewClient("http://localhost", "tok")
	// Circuit already closed — ResetCircuit should be a no-op (no panic, no state change).
	c.ResetCircuit()

	c.mu.Lock()
	st := c.state
	f := c.failures
	c.mu.Unlock()

	if st != stateClosed {
		t.Error("expected state to remain closed")
	}
	if f != 0 {
		t.Errorf("expected failures=0, got %d", f)
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

	c.mu.Lock()
	st := c.state
	f := c.failures
	c.mu.Unlock()

	if st != stateClosed {
		t.Error("PostBestEffort must not trip the circuit breaker")
	}
	if f != 0 {
		t.Errorf("PostBestEffort must not increment failure counter, got failures=%d", f)
	}
}

func TestCircuitBreakerConcurrency(t *testing.T) {
	var mu sync.Mutex
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		n := callCount
		mu.Unlock()
		if n%2 == 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	// Use minimal retry backoff so the test completes quickly.
	c.retryConfig = RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     1 * time.Millisecond,
		Multiplier:      1.0,
		MaxElapsedTime:  1 * time.Second,
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = c.Post("/agent/sync/heartbeat", struct{}{})
		}()
	}
	wg.Wait()

	// Verify no stuck probe state after concurrent access.
	c.mu.Lock()
	pif := c.probeInFlight
	st := c.state
	c.mu.Unlock()
	if pif && st != stateHalfOpen {
		t.Errorf("probeInFlight=true but state=%d (not half-open) — stuck state after concurrency", st)
	}
}

func TestCircuitBreakerHalfOpen(t *testing.T) {
	var attempts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int(attempts.Add(1))
		if n == 1 {
			w.WriteHeader(http.StatusOK) // probe succeeds
		} else {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	c.retryConfig = RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     1 * time.Millisecond,
		Multiplier:      1.0,
		MaxElapsedTime:  500 * time.Millisecond,
	}

	// Trip circuit deterministically via direct state manipulation.
	c.mu.Lock()
	c.failures = circuitOpenThreshold
	c.state = stateOpen
	c.openedAt = time.Now()
	c.resetTimeout = 50 * time.Millisecond
	c.mu.Unlock()

	// Verify circuit is open.
	c.mu.Lock()
	if c.state != stateOpen {
		c.mu.Unlock()
		t.Fatal("circuit should be open after direct state set")
	}
	c.mu.Unlock()

	// Wait for reset timeout → next IsAvailable() transitions to half-open.
	time.Sleep(100 * time.Millisecond)

	// Send one probe — IsAvailable transitions to half-open, sets probeInFlight,
	// probe succeeds, recordSuccess closes circuit.
	if err := c.Post("/agent/sync/heartbeat", struct{}{}); err != nil {
		t.Fatalf("probe post failed: %v", err)
	}

	// Verify circuit is closed.
	c.mu.Lock()
	if c.state != stateClosed {
		st := c.state
		c.mu.Unlock()
		t.Fatalf("circuit should be closed after successful probe, got state=%d", st)
	}
	c.mu.Unlock()
}
