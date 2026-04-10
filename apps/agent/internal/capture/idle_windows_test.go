//go:build windows

package capture

import (
	"testing"
)

func TestIdleWraparound24hCap(t *testing.T) {
	// Seed a known last-good value.
	lastKnownIdleSec.Store(42)

	// 25 hours in ms — exceeds the 24-hour cap; must return last known value.
	spike := uint64(25 * 60 * 60 * 1000)
	got := applyIdleCap(spike)
	if got != 42 {
		t.Fatalf("spike: expected last known value 42, got %d", got)
	}

	// Normal value (5 minutes) — must update lastKnownIdleSec and return 300.
	normal := uint64(5 * 60 * 1000)
	got = applyIdleCap(normal)
	if got != 300 {
		t.Fatalf("normal: expected 300 seconds, got %d", got)
	}

	// Spike again after a normal read — must return the updated last known (300).
	got = applyIdleCap(spike)
	if got != 300 {
		t.Fatalf("spike after update: expected 300, got %d", got)
	}

	// Zero diffMs is valid (user just clicked) — must store 0 and return 0.
	got = applyIdleCap(0)
	if got != 0 {
		t.Fatalf("zero: expected 0, got %d", got)
	}

	// Exactly at the cap boundary — 24h in ms is NOT a spike, should store it.
	boundary := maxReasonableIdleMs
	got = applyIdleCap(boundary)
	want := int(boundary / 1000)
	if got != want {
		t.Fatalf("boundary: expected %d, got %d", want, got)
	}
}
