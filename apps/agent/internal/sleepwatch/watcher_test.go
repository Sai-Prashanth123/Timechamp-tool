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

	base := time.Now()
	callCount := 0
	mockNow := func() time.Time {
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
	w.Stop()

	w.Signal(Resume)
	select {
	case <-w.C:
		select {
		case <-w.C:
			t.Fatal("received second event after Stop")
		case <-time.After(200 * time.Millisecond):
		}
	case <-time.After(200 * time.Millisecond):
	}
}
