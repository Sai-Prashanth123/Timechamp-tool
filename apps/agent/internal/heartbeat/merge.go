// Package heartbeat implements the core event coalescing algorithms from
// ActivityWatch (github.com/ActivityWatch/activitywatch, Apache 2.0 licence).
//
// Key algorithms:
//   - HeartbeatMerge  — merges two identical adjacent events into one longer event
//   - Flood           — fills small gaps between events of the same type
//   - Queue           — client-side pre-merge queue that batches events before
//     uploading, reducing storage and bandwidth by 80-90%
package heartbeat

import (
	"reflect"
	"sort"
	"sync"
	"time"
)

// Event mirrors the buffer.ActivityEvent but is type-agnostic so the heartbeat
// package can be used without importing the buffer package.
type Event struct {
	Timestamp time.Time
	Duration  time.Duration
	Data      map[string]string // app, title, url, category, incognito
}

// Equal returns true when two events have identical data payloads.
func (e *Event) Equal(other *Event) bool {
	return reflect.DeepEqual(e.Data, other.Data)
}

// HeartbeatMerge attempts to merge heartbeat into lastEvent.
//
// Merge conditions (from ActivityWatch aw-core):
//  1. Data payloads must be identical.
//  2. heartbeat.Timestamp must fall within [lastEvent.Timestamp,
//     lastEvent.Timestamp + lastEvent.Duration + pulsetime].
//
// On success the merged event is returned (lastEvent is mutated in place).
// Returns nil if the events cannot be merged.
func HeartbeatMerge(lastEvent, heartbeat *Event, pulsetime time.Duration) *Event {
	if lastEvent == nil || heartbeat == nil {
		return nil
	}
	if !lastEvent.Equal(heartbeat) {
		return nil
	}

	pulseEnd := lastEvent.Timestamp.Add(lastEvent.Duration).Add(pulsetime)

	if heartbeat.Timestamp.Before(lastEvent.Timestamp) ||
		heartbeat.Timestamp.After(pulseEnd) {
		return nil
	}

	// Extend duration: new_duration = (heartbeat.ts - last.ts) + heartbeat.duration
	newDur := heartbeat.Timestamp.Sub(lastEvent.Timestamp) + heartbeat.Duration
	if newDur > lastEvent.Duration {
		lastEvent.Duration = newDur
	}
	return lastEvent
}

// Flood fills gaps of ≤ pulsetime between adjacent events.
//
// For two adjacent events e1 and e2:
//   - If the gap ≤ pulsetime AND data is identical → merge into one event.
//   - If the gap ≤ pulsetime AND data differs → extend the longer event to
//     close the gap (no data is lost).
//   - Zero-duration events produced by merging are removed.
//
// Input slice is sorted by Timestamp. The returned slice is always sorted.
func Flood(events []Event, pulsetime time.Duration) []Event {
	if len(events) < 2 {
		return events
	}

	sort.Slice(events, func(i, j int) bool {
		return events[i].Timestamp.Before(events[j].Timestamp)
	})

	result := make([]Event, len(events))
	copy(result, events)

	for i := 0; i < len(result)-1; i++ {
		e1 := &result[i]
		e2 := &result[i+1]

		end1 := e1.Timestamp.Add(e1.Duration)
		gap := e2.Timestamp.Sub(end1)

		if gap <= 0 || gap > pulsetime {
			continue
		}

		if e1.Equal(e2) {
			// Merge: extend e1 to cover e2, zero out e2.
			e1.Duration = e2.Timestamp.Add(e2.Duration).Sub(e1.Timestamp)
			e2.Duration = 0
		} else if e1.Duration >= e2.Duration {
			// e1 is longer — extend it to touch e2's start.
			e1.Duration = e2.Timestamp.Sub(e1.Timestamp)
		} else {
			// e2 is longer — push e2's start back to e1's end.
			newStart := end1
			e2.Duration = e2.Timestamp.Add(e2.Duration).Sub(newStart)
			e2.Timestamp = newStart
		}
	}

	// Remove zero-duration events.
	out := result[:0]
	for _, e := range result {
		if e.Duration > 0 {
			out = append(out, e)
		}
	}
	return out
}

// -----------------------------------------------------------------------------
// Queue — client-side pre-merge queue
// -----------------------------------------------------------------------------

// CommitHandler is called when an event is ready to be persisted.
type CommitHandler func(e Event)

// Queue accumulates heartbeat events and merges identical consecutive ones
// before committing them to persistent storage. This mirrors the RequestQueue
// in ActivityWatch's Python client.
//
// Usage:
//
//	q := NewQueue(60*time.Second, func(e Event) { db.Insert(e) })
//	q.Push("window", event, 2*time.Second)
//	q.Flush()
type Queue struct {
	commitInterval time.Duration
	onCommit       CommitHandler

	mu            sync.Mutex
	lastHeartbeat map[string]*Event // keyed by bucket/stream name
}

// NewQueue creates a pre-merge event queue.
//   - commitInterval: flush a cached merged event once its duration exceeds this.
//   - onCommit: called synchronously when an event is ready to persist.
func NewQueue(commitInterval time.Duration, onCommit CommitHandler) *Queue {
	return &Queue{
		commitInterval: commitInterval,
		onCommit:       onCommit,
		lastHeartbeat:  make(map[string]*Event),
	}
}

// maxEventDuration caps the duration a single cached event can accumulate
// before it is force-committed. Guards against memory growth on very long
// sessions or if commitInterval is misconfigured to a large value.
const maxEventDuration = time.Hour

// Push feeds a new heartbeat into the queue for the given stream.
// pulsetime is the merge window (typically poll_interval + 1 s).
func (q *Queue) Push(stream string, event Event, pulsetime time.Duration) {
	q.mu.Lock()
	defer q.mu.Unlock()

	last, exists := q.lastHeartbeat[stream]
	if !exists {
		e := event
		q.lastHeartbeat[stream] = &e
		return
	}

	merged := HeartbeatMerge(last, &event, pulsetime)
	if merged != nil {
		// Successfully merged — check commit threshold.
		if merged.Duration >= q.commitInterval {
			q.onCommit(*merged)
			e := event
			q.lastHeartbeat[stream] = &e
		} else if merged.Duration >= maxEventDuration {
			// Hour cap: commit before the cached event grows unboundedly.
			q.onCommit(*merged)
			e := event
			q.lastHeartbeat[stream] = &e
		}
		// else: keep the merged event cached for further merging
		return
	}

	// Cannot merge — commit the cached event, start fresh.
	q.onCommit(*last)
	e := event
	q.lastHeartbeat[stream] = &e
}

// Flush commits all cached events immediately (call on shutdown or after idle).
func (q *Queue) Flush(stream string) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if last, ok := q.lastHeartbeat[stream]; ok && last.Duration > 0 {
		q.onCommit(*last)
		delete(q.lastHeartbeat, stream)
	}
}

// FlushAll commits all streams.
func (q *Queue) FlushAll() {
	q.mu.Lock()
	defer q.mu.Unlock()

	for stream, last := range q.lastHeartbeat {
		if last.Duration > 0 {
			q.onCommit(*last)
		}
		delete(q.lastHeartbeat, stream)
	}
}
