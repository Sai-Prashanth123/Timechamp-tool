//go:build darwin

package capture

import (
	"os/exec"
	"strings"
)

// getActiveWindow returns the frontmost application name and window title on
// macOS by invoking osascript with an AppleScript snippet.
// System Events requires Accessibility permission for the agent process.
func getActiveWindow() (ActiveWindow, error) {
	script := `tell application "System Events"
		set frontApp to first application process whose frontmost is true
		set appName to name of frontApp
		set windowTitle to ""
		try
			set windowTitle to name of first window of frontApp
		end try
		return appName & "|" & windowTitle
	end tell`

	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		// Return a safe fallback rather than a hard error so the main loop
		// keeps running even when Accessibility is not yet granted.
		return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
	}

	line := strings.TrimSpace(string(out))
	parts := strings.SplitN(line, "|", 2)
	if len(parts) == 2 {
		return ActiveWindow{AppName: parts[0], WindowTitle: parts[1]}, nil
	}
	return ActiveWindow{AppName: line, WindowTitle: ""}, nil
}
