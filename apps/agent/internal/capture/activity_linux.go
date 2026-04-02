//go:build linux

package capture

import (
	"os/exec"
	"strings"
)

// getActiveWindow returns the focused application and window title on Linux
// by querying xdotool(1).  xdotool must be installed on the host.
// Falls back to safe zero-values when xdotool is unavailable or when the
// desktop session does not expose an active window (e.g. on a bare VT).
func getActiveWindow() (ActiveWindow, error) {
	// Get the active window ID
	idOut, err := exec.Command("xdotool", "getactivewindow").Output()
	if err != nil {
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
