package sync

import (
	"math/rand"
	"sync"
	"time"
)

// NewJitteredTicker returns a ticker that fires at base ± 30%.
// Example: base=30s → fires between 21s and 39s.
// Each tick interval is independently randomised.
// Call Stop() exactly once when done; Stop() is safe to call from multiple goroutines.
func NewJitteredTicker(base time.Duration) *jitteredTicker {
	t := &jitteredTicker{
		base: base,
		C:    make(chan time.Time, 1),
		stop: make(chan struct{}),
	}
	go t.run()
	return t
}

type jitteredTicker struct {
	base time.Duration
	C    chan time.Time
	stop chan struct{}
	once sync.Once
}

// Stop signals the ticker to stop. Safe to call from multiple goroutines;
// subsequent calls after the first are no-ops.
func (t *jitteredTicker) Stop() { t.once.Do(func() { close(t.stop) }) }

func (t *jitteredTicker) run() {
	for {
		// Full interval in [0.7*base, 1.3*base]
		interval := time.Duration(float64(t.base) * (0.7 + rand.Float64()*0.6))
		timer := time.NewTimer(interval)
		select {
		case <-timer.C:
			timer.Stop() // already fired, harmless; prevents internal GC delay
			select {
			case t.C <- time.Now():
			default: // drop tick if consumer is slow
			}
		case <-t.stop:
			timer.Stop()
			return
		}
	}
}
