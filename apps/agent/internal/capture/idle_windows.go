//go:build windows

package capture

import (
	"fmt"
	"sync/atomic"
	"unsafe"
)

// maxReasonableIdleMs is 24 hours in milliseconds.
// GetLastInputInfo's 32-bit tick counter can produce spurious large deltas
// (e.g. immediately after boot or due to clock skew). Any diffMs larger than
// this is clamped to the last known plausible reading.
const maxReasonableIdleMs = uint64(24 * 60 * 60 * 1000)

// lastKnownIdleSec stores the most recent plausible idle-seconds value.
// Written by applyIdleCap; read as a fallback when diffMs exceeds the cap.
var lastKnownIdleSec atomic.Uint32

// applyIdleCap converts diffMs to seconds and applies the 24-hour spike filter.
// If diffMs > maxReasonableIdleMs, the last known plausible value is returned
// unchanged. Otherwise the new value is stored atomically and returned.
func applyIdleCap(diffMs uint64) int {
	if diffMs > maxReasonableIdleMs {
		return int(lastKnownIdleSec.Load())
	}
	secs := uint32(diffMs / 1000)
	lastKnownIdleSec.Store(secs)
	return int(secs)
}

// lastInputInfo mirrors the Win32 LASTINPUTINFO structure.
type lastInputInfo struct {
	cbSize uint32
	dwTime uint32 // 32-bit tick count of last input (wraps every ~49.7 days)
}

// idleSeconds returns the number of seconds since the user last provided input.
//
// Implementation note (from ActivityWatch aw-watcher-afk/windows.py):
// GetLastInputInfo returns a 32-bit DWORD tick count that wraps around every
// ~49.7 days. GetTickCount64 provides the 64-bit uptime. We mask the 64-bit
// value to 32 bits and handle the wraparound case explicitly so that agents
// running on always-on machines stay accurate across the wrap boundary.
// An additional 24-hour spike filter (applyIdleCap) guards against spurious
// large deltas that can occur immediately after boot or a clock discontinuity.
func idleSeconds() (int, error) {
	// Get 64-bit uptime tick.
	tickCount64, _, _ := getTickCount64Proc.Call()

	// GetLastInputInfo — fill the 32-bit DWORD tick of last input.
	var info lastInputInfo
	info.cbSize = uint32(unsafe.Sizeof(info))
	ret, _, err := getLastInputInfoProc.Call(uintptr(unsafe.Pointer(&info)))
	if ret == 0 {
		return 0, fmt.Errorf("GetLastInputInfo: %w", err)
	}

	// ── 32-bit wraparound correction ──────────────────────────────────────────
	// tickCount64 & 0xFFFFFFFF gives the lower 32 bits of the 64-bit counter.
	// If lower32(now) < info.dwTime, the 32-bit counter wrapped since the last
	// input event.
	tickLower32 := uint32(tickCount64 & 0xFFFFFFFF)

	var diffMs uint64
	if tickLower32 >= info.dwTime {
		diffMs = uint64(tickLower32 - info.dwTime)
	} else {
		// Wraparound: the counter rolled over from 0xFFFFFFFF → 0 since last input.
		diffMs = (0x100000000 - uint64(info.dwTime)) + uint64(tickLower32)
	}

	return applyIdleCap(diffMs), nil
}
