package capture

import (
	"log"
	"sync/atomic"
)

// idleBaselineOffset is subtracted from raw idle readings after a system wake.
// Set by ResetIdleBaseline to the raw idle at wake time (which includes the
// sleep duration). Auto-clears when raw idle drops below it (user became active).
// Atomic int64, stores seconds.
var idleBaselineOffset int64

// idleSecondsFunc is the injectable idle-time query — overridden in tests.
// Tests must NOT run in parallel (no t.Parallel()) because they overwrite this variable.
var idleSecondsFunc = idleSeconds

// ResetIdleBaseline records the current raw idle at system wake time.
// All subsequent IdleSeconds calls subtract this value so that the sleep
// duration is never counted as user idle time.
// Thread-safe; safe to call from a goroutine.
func ResetIdleBaseline() {
	raw, err := idleSecondsFunc()
	if err != nil {
		log.Printf("sleepwatch: ResetIdleBaseline: could not read idle time: %v; sleep duration may inflate idle counter", err)
		return
	}
	atomic.StoreInt64(&idleBaselineOffset, int64(raw))
}

// IdleSeconds returns the number of seconds since the user last had input,
// corrected for any sleep gap recorded by ResetIdleBaseline.
//
// Correction logic:
//   - No baseline (offset == 0): return raw value unchanged.
//   - raw >= offset: return raw - offset (actual post-wake idle).
//   - raw < offset: user became active post-wake; clear baseline, return 0.
func IdleSeconds() (int, error) {
	raw, err := idleSecondsFunc()
	if err != nil {
		return 0, err
	}

	offset := atomic.LoadInt64(&idleBaselineOffset)
	if offset == 0 {
		return int(raw), nil
	}

	result := int64(raw) - offset
	if result < 0 {
		// User has been active since wake: raw idle reset below baseline.
		// Clear offset so future readings are unaffected.
		atomic.StoreInt64(&idleBaselineOffset, 0)
		return 0, nil
	}
	return int(result), nil
}
