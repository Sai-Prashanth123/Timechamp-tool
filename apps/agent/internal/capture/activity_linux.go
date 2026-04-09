//go:build linux

package capture

import (
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
)

var (
	warnWayland   sync.Once
	warnXdotool   sync.Once
)

// getActiveWindow returns the focused application and window title on Linux
// by querying xdotool(1).  xdotool must be installed on the host.
// Falls back to safe zero-values when xdotool is unavailable or when the
// desktop session does not expose an active window (e.g. on a bare VT).
func getActiveWindow() (ActiveWindow, error) {
	// Wayland sessions are not supported by xdotool (X11-only).
	// Warn once so the user knows why activity tracking is missing.
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		warnWayland.Do(func() {
			log.Printf("Warning: Wayland session detected. xdotool requires X11. " +
				"Activity window tracking is unavailable. " +
				"Run with XWayland or set DISPLAY to enable tracking.")
		})
		return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
	}

	// Get the active window ID
	idOut, err := exec.Command("xdotool", "getactivewindow").Output()
	if err != nil {
		warnXdotool.Do(func() {
			if _, lookErr := exec.LookPath("xdotool"); lookErr != nil {
				log.Printf("Warning: xdotool not found. Activity window tracking is disabled. " +
					"Install with: apt install xdotool  (or your distro's equivalent).")
			}
		})
		return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
	}
	winID := strings.TrimSpace(string(idOut))

	// Get window title
	titleOut, _ := exec.Command("xdotool", "getwindowname", winID).Output()
	title := strings.TrimSpace(string(titleOut))

	// Resolve the owning process name via the window's PID
	appName := "Unknown"
	pidOut, err := exec.Command("xdotool", "getwindowpid", winID).Output()
	if err == nil {
		pid := strings.TrimSpace(string(pidOut))
		if pid != "" {
			// ps -p <pid> -o comm=  prints the process basename, no header
			if procOut, err2 := exec.Command("ps", "-p", pid, "-o", "comm=").Output(); err2 == nil {
				if name := strings.TrimSpace(string(procOut)); name != "" {
					appName = name
				}
			}
		}
	}

	return ActiveWindow{AppName: appName, WindowTitle: title}, nil
}
