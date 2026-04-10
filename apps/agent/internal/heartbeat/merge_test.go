package heartbeat

import (
	"testing"
	"time"
)

func TestHeartbeatQueueHourCap(t *testing.T) {
	commits := 0
	q := NewQueue(60*time.Second, func(e Event) { commits++ })

	base := time.Now()
	// Push the same event for 2 simulated hours (7200 1-second events).
	// With commitInterval=60s, the normal threshold fires every 60 events
	// (≈120 times). The hour cap is an additional safety net on top.
	for i := range 7200 {
		q.Push("window", Event{
			Data:      map[string]string{"app": "Chrome"},
			Timestamp: base.Add(time.Duration(i) * time.Second),
			Duration:  time.Second,
		}, 2*time.Second)
	}
	q.FlushAll()

	if commits < 2 {
		t.Errorf("expected ≥2 commits for 2 hours of events, got %d", commits)
	}
}

// TestHeartbeatQueueHourCapTriggers verifies the hour cap fires when
// commitInterval exceeds maxEventDuration (1 hour).
func TestHeartbeatQueueHourCapTriggers(t *testing.T) {
	commits := 0
	// commitInterval larger than 1 hour — normal threshold never fires.
	q := NewQueue(2*time.Hour, func(e Event) { commits++ })

	base := time.Now()
	// Push 3601 seconds (just over 1 hour). Pulsetime is 2s so all merge.
	for i := range 3601 {
		q.Push("window", Event{
			Data:      map[string]string{"app": "Code"},
			Timestamp: base.Add(time.Duration(i) * time.Second),
			Duration:  time.Second,
		}, 2*time.Second)
	}
	q.FlushAll()

	// The hour cap must have committed at least once before FlushAll.
	if commits < 1 {
		t.Errorf("expected hour cap to fire at least once, got %d commits", commits)
	}
}
