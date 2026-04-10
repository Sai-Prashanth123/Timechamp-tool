// Package sleepwatch detects system resume events by comparing wall-clock time
// against the poll interval. When the machine sleeps, the monotonic clock
// pauses but the wall clock jumps — so a large gap between wall-clock readings
// indicates a wake event.
//
// Note: Suspend events cannot be auto-detected (the process is frozen before
// sleep). Suspend events are only emitted when injected via Signal(Suspend).
package sleepwatch

import (
	"sync"
	"time"
)

// EventType identifies the kind of power event.
type EventType string

const (
	// Suspend is only emitted when injected via Signal(Suspend).
	// The drift detector cannot fire before sleep because the process is frozen.
	Suspend EventType = "suspend"
	Resume  EventType = "resume"
)

// Event is emitted on C whenever a suspend/resume transition is detected.
type Event struct {
	Type     EventType
	At       time.Time
	Duration time.Duration
}

// defaultDebounce is how long to suppress duplicate Resume events.
const defaultDebounce = 3 * time.Second

// Watcher monitors for system sleep/wake by watching wall-clock drift.
type Watcher struct {
	// C receives power events. Buffered (cap 4); drops if consumer is slow.
	C <-chan Event

	nowFn     func() time.Time
	poll      time.Duration
	threshold time.Duration
	debounce  time.Duration

	ch       chan Event
	stopCh   chan struct{}
	sigCh    chan EventType
	startMu  sync.Mutex
	started  bool
	stopOnce sync.Once

	mu           sync.Mutex
	lastResumeAt time.Time
}

// New returns a production Watcher using a 5-second poll and 10-second
// threshold (large enough to survive scheduler jitter, small enough to catch
// any real sleep).
func New() *Watcher {
	return newWatcher(time.Now, 5*time.Second, 10*time.Second)
}

// newWatcher constructs a Watcher with custom clock and timing — used by tests.
func newWatcher(nowFn func() time.Time, poll, threshold time.Duration) *Watcher {
	ch := make(chan Event, 4)
	return &Watcher{
		C:         ch,
		ch:        ch,
		nowFn:     nowFn,
		poll:      poll,
		threshold: threshold,
		debounce:  defaultDebounce,
		stopCh:    make(chan struct{}),
		sigCh:     make(chan EventType, 8),
	}
}

// Start launches the background monitor goroutine. Idempotent — safe to call
// multiple times; only the first call has effect.
func (w *Watcher) Start() {
	w.startMu.Lock()
	defer w.startMu.Unlock()
	if w.started {
		return
	}
	w.started = true
	go w.run()
}

// Stop shuts down the background goroutine. Idempotent.
func (w *Watcher) Stop() {
	w.stopOnce.Do(func() {
		close(w.stopCh)
	})
}

// Done returns a channel that is closed when the watcher stops.
// Use this to exit select loops over C after Stop() is called, since C
// itself is never closed (to avoid spurious zero-value reads in selects).
//
//	for {
//	    select {
//	    case event := <-w.C:
//	        // handle event
//	    case <-w.Done():
//	        return
//	    }
//	}
func (w *Watcher) Done() <-chan struct{} {
	return w.stopCh
}

// Signal injects an external OS power event (e.g. from platform-specific
// power notification APIs). Resume passes through the debounce logic.
// Suspend is emitted directly — it is the only way Suspend events are fired.
func (w *Watcher) Signal(t EventType) {
	select {
	case w.sigCh <- t:
	default:
		// sigCh full — drop; the consumer loop will catch it on next tick.
	}
}

// run is the main goroutine: polls wall-clock drift and handles injected signals.
func (w *Watcher) run() {
	// Use .Round(0) to strip the monotonic reading so Sub() uses wall-clock.
	prev := w.nowFn().Round(0)
	ticker := time.NewTicker(w.poll)
	defer ticker.Stop()

	for {
		select {
		case <-w.stopCh:
			return

		case evtType := <-w.sigCh:
			switch evtType {
			case Resume:
				w.emitResume(0)
			case Suspend:
				w.emit(Event{Type: Suspend, At: w.nowFn()})
			}

		case <-ticker.C:
			now := w.nowFn().Round(0)
			elapsed := now.Sub(prev)
			prev = now

			gap := elapsed - w.poll
			if gap > w.threshold {
				w.emitResume(gap)
			}
		}
	}
}

// emit sends an event non-blocking — drops if consumer is too slow.
func (w *Watcher) emit(evt Event) {
	select {
	case w.ch <- evt:
	default:
	}
}

// emitResume fires a Resume event, subject to the debounce window.
func (w *Watcher) emitResume(gap time.Duration) {
	now := w.nowFn().Round(0)
	w.mu.Lock()
	if !w.lastResumeAt.IsZero() && now.Sub(w.lastResumeAt) < w.debounce {
		w.mu.Unlock()
		return
	}
	w.lastResumeAt = now
	w.mu.Unlock()

	evt := Event{Type: Resume, At: now, Duration: gap}
	select {
	case w.ch <- evt:
	default:
	}
}
