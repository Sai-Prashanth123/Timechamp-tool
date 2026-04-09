//go:build darwin

package capture

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// idleSeconds returns the number of seconds the system has been idle (no
// keyboard or mouse input) on macOS.
//
// It queries IOHIDSystem via ioreg(8), which is available on every macOS
// installation without additional software.  The idle time is reported in
// nanoseconds under the key "HIDIdleTime".
// ioregTimeout caps how long we wait for ioreg. A kernel hang can cause it
// to block indefinitely, which would freeze the main event loop.
const ioregTimeout = 5 * time.Second

func idleSeconds() (int, error) {
	// ioreg -c IOHIDSystem -d 4 prints the IOHIDSystem entry including
	// HIDIdleTime (nanoseconds since last user input).
	ctx, cancel := context.WithTimeout(context.Background(), ioregTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ioreg", "-c", "IOHIDSystem", "-d", "4").Output()
	if err != nil {
		return 0, fmt.Errorf("ioreg: %w", err)
	}

	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, "HIDIdleTime") {
			continue
		}
		// Line format:  "HIDIdleTime" = 12345678901
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		ns, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
		if err != nil {
			continue
		}
		// Convert nanoseconds → seconds
		return int(ns / 1_000_000_000), nil
	}

	return 0, fmt.Errorf("HIDIdleTime not found in ioreg output")
}
