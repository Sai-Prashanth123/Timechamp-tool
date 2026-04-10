package sleepwatch

import (
	"sync"
	"testing"
	"time"
)

func TestWatcher_DetectsWakeViaWallClockDrift(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	calls := 0
	base := time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC)

	mockNow := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if calls == 1 {
			return base
		}
		return base.Add(4 * time.Minute)
	}

	w := newWatcher(mockNow, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	defer w.Stop()

	select {
	case evt := <-w.C:
		if evt.Type != Resume {
			t.Fatalf("expected Resume, got %q", evt.Type)
		}
		if evt.Duration < 3*time.Minute {
			t.Errorf("expected duration ~4m, got %v", evt.Duration)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout: no Resume event received")
	}
}

func TestWatcher_NoFalsePositiveUnderLoad(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	base := time.Now()
	callCount := 0
	mockNow := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		callCount++
		return base.Add(time.Duration(callCount) * 50 * time.Millisecond)
	}

	w := newWatcher(mockNow, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	defer w.Stop()

	select {
	case evt := <-w.C:
		t.Fatalf("unexpected event: type=%q duration=%v", evt.Type, evt.Duration)
	case <-time.After(400 * time.Millisecond):
	}
}

func TestWatcher_Signal_InjectsResumeEvent(t *testing.T) {
	t.Parallel()

	w := newWatcher(time.Now, 1*time.Hour, 30*time.Minute)
	w.Start()
	defer w.Stop()

	w.Signal(Resume)

	select {
	case evt := <-w.C:
		if evt.Type != Resume {
			t.Fatalf("expected Resume, got %q", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout: no event after Signal(Resume)")
	}
}

func TestWatcher_DebounceCollapsesDuplicates(t *testing.T) {
	t.Parallel()

	w := newWatcher(time.Now, 1*time.Hour, 30*time.Minute)
	w.Start()
	defer w.Stop()

	w.Signal(Resume)
	w.Signal(Resume)

	count := 0
	deadline := time.After(300 * time.Millisecond)
loop:
	for {
		select {
		case <-w.C:
			count++
		case <-deadline:
			break loop
		}
	}
	if count != 1 {
		t.Errorf("expected 1 Resume event (debounce), got %d", count)
	}
}

func TestWatcher_StopPreventsEvents(t *testing.T) {
	t.Parallel()

	w := newWatcher(time.Now, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	// Give goroutine time to start, then stop it
	time.Sleep(20 * time.Millisecond)
	w.Stop()

	// Drain any events that arrived before Stop
	for {
		select {
		case <-w.C:
		default:
			goto drained
		}
	}
drained:
	// After draining, no further events should arrive
	w.Signal(Resume) // sigCh buffered but goroutine is stopped, so nothing reads it
	select {
	case evt := <-w.C:
		t.Fatalf("received event after Stop: type=%q", evt.Type)
	case <-time.After(200 * time.Millisecond):
		// Correct — no events
	}
}
