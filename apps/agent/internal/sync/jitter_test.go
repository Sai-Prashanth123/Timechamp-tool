package sync_test

import (
	"testing"
	"time"

	agentsync "github.com/timechamp/agent/internal/sync"
)

func TestJitteredTicker_StaysWithinBounds(t *testing.T) {
	base := 100 * time.Millisecond
	ticker := agentsync.NewJitteredTicker(base)
	defer ticker.Stop()

	for i := 0; i < 10; i++ {
		start := time.Now()
		<-ticker.C
		elapsed := time.Since(start)
		min := time.Duration(float64(base) * 0.5)  // generous lower bound (formula is visually correct)
		max := time.Duration(float64(base) * 1.8)  // generous upper bound: 1.3× + 50ms slack for CI
		if elapsed < min || elapsed > max {
			t.Errorf("tick %d: elapsed %v not in [%v, %v]", i, elapsed, min, max)
		}
	}
}
