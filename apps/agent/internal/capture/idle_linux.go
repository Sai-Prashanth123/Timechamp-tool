//go:build linux

package capture

import (
	"fmt"
	"log"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// idleSeconds returns the number of seconds since the last user input on Linux.
//
// Primary tool: xprintidle(1), which reports idle time in milliseconds.
// Fallback: xdotool(1) with "getactivewindow" cannot give idle time directly,
// so when xprintidle is unavailable we return 0 (optimistic: treat as active)
// and log nothing — the caller handles a zero idle as "user is present".
var warnXprintidle sync.Once

func idleSeconds() (int, error) {
	out, err := exec.Command("xprintidle").Output()
	if err != nil {
		warnXprintidle.Do(func() {
			if _, lookErr := exec.LookPath("xprintidle"); lookErr != nil {
				log.Printf("Warning: xprintidle not found. AFK idle detection is disabled (user always treated as active). " +
					"Install with: apt install xprintidle  (or your distro's equivalent).")
			}
		})
		return 0, nil
	}

	ms, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("xprintidle: parse %q: %w", strings.TrimSpace(string(out)), err)
	}

	return int(ms / 1000), nil
}
