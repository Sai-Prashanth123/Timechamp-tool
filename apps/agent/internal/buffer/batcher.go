package buffer

import (
	"log"
	"sync"
	"time"
)

// WriteBatcher accumulates activity events and flushes them as a single
// SQLite transaction every window duration or when maxBatch is reached.
// This gives ~100x write throughput vs individual inserts because the
// prepared statement is compiled once and all rows share one fsync.
type WriteBatcher struct {
	db       *DB
	mu       sync.Mutex
	pending  []ActivityEvent
	timer    *time.Timer
	maxBatch int
	window   time.Duration
}

// NewWriteBatcher creates a batcher. Flush happens every window or at maxBatch events.
func NewWriteBatcher(db *DB, window time.Duration, maxBatch int) *WriteBatcher {
	return &WriteBatcher{db: db, window: window, maxBatch: maxBatch}
}

// Add queues an event for batched insertion.
func (b *WriteBatcher) Add(e ActivityEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = append(b.pending, e)
	if len(b.pending) >= b.maxBatch {
		b.flushLocked()
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(b.window, b.Flush)
	}
}

// Flush writes all pending events to SQLite immediately. Safe to call on shutdown.
func (b *WriteBatcher) Flush() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.flushLocked()
}

func (b *WriteBatcher) flushLocked() {
	if len(b.pending) == 0 {
		return
	}
	events := make([]ActivityEvent, len(b.pending))
	copy(events, b.pending)
	b.pending = b.pending[:0]
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	if err := b.db.InsertActivityBatch(events); err != nil {
		log.Printf("[batcher] flush failed (%d events): %v", len(events), err)
		b.db.DroppedEvents.Add(uint64(len(events)))
	}
}
