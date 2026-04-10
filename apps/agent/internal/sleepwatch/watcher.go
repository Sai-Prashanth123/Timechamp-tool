// Package sleepwatch detects system suspend/resume events by comparing
// wall-clock time against the poll interval. When the machine sleeps, the
// monotonic clock pauses but the wall clock jumps — so a large gap between
// wall-clock readings indicates a wake event.
package sleepwatch

import (
	"sync"
	"time"
)

// EventType identifies the kind of power event.
type EventType string

const (
	Suspend EventType = "suspend"
	Resume  EventType = "resume"
)

// Event is emitted on C whenever a suspend/resume transition is detected.
type Event struct {
	Type     EventType
	At       time.Time
	Duration time.Duration
}

// debounceWindow is how long to suppress duplicate Resume events.
const debounceWindow = 3 * time.Second

// Watcher monitors for system sleep/wake by watching wall-clock drift.
type Watcher struct {
	// C receives power events. Buffered (cap 4); drops if consumer is slow.
	C <-chan Event

	nowFn     func() time.Time
	poll      time.Duration
	threshold time.Duration

	ch      chan Event
	stopCh  chan struct{}
	sigCh   chan EventType
	startMu sync.Mutex
	started bool
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

// Signal injects an external OS power event (e.g. from platform-specific
// power notification APIs). The event passes through the debounce logic.
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
			if evtType == Resume {
				w.emitResume(0)
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

// emitResume fires a Resume event, subject to the debounce window.
func (w *Watcher) emitResume(gap time.Duration) {
	w.mu.Lock()
	if !w.lastResumeAt.IsZero() && time.Since(w.lastResumeAt) < debounceWindow {
		w.mu.Unlock()
		return
	}
	w.lastResumeAt = time.Now()
	w.mu.Unlock()

	evt := Event{
		Type:     Resume,
		At:       time.Now(),
		Duration: gap,
	}

	// Non-blocking send — drop if consumer is too slow.
	select {
	case w.ch <- evt:
	default:
	}
}
