//go:build darwin

package capture

import (
	"os/exec"
	"strings"
)

// knownBrowserApps maps macOS application names to their AppleScript target name.
var knownBrowserApps = map[string]string{
	"google chrome":  "Google Chrome",
	"chrome":         "Google Chrome",
	"microsoft edge": "Microsoft Edge",
	"edge":           "Microsoft Edge",
	"safari":         "Safari",
	"firefox":        "Firefox",
	"brave browser":  "Brave Browser",
	"opera":          "Opera",
	"vivaldi":        "Vivaldi",
	"arc":            "Arc",
}

// getBrowserURL extracts the current URL from the frontmost browser window using
// AppleScript. appName is the macOS application name as returned by System Events.
func getBrowserURL(appName string) string {
	lower := strings.ToLower(strings.TrimSpace(appName))
	target, ok := knownBrowserApps[lower]
	if !ok {
		return ""
	}

	var script string
	switch target {
	case "Safari":
		script = `tell application "Safari" to get URL of current tab of front window`
	case "Firefox":
		// Firefox doesn't expose URL via standard AppleScript; use window title fallback.
		return firefoxURLFromTitle()
	default:
		// Chromium-based browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc)
		script = `tell application "` + target + `" to get URL of active tab of first window`
	}

	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return ""
	}
	url := strings.TrimSpace(string(out))
	if looksLikeURL(url) {
		return url
	}
	return ""
}

// firefoxURLFromTitle reads the Firefox window title and tries to extract a URL.
// Firefox on macOS shows "<Page Title> — Mozilla Firefox" in the title bar.
func firefoxURLFromTitle() string {
	script := `tell application "System Events"
		set frontApp to first application process whose name is "firefox"
		if (count of frontApp) > 0 then
			return name of first window of frontApp
		end if
		return ""
	end tell`

	out, err := exec.Command("osascript", "-e", script).Output()
	if err != nil {
		return ""
	}
	title := strings.TrimSpace(string(out))
	for _, suffix := range []string{" — Mozilla Firefox", " - Mozilla Firefox", " – Mozilla Firefox"} {
		if idx := strings.LastIndex(title, suffix); idx > 0 {
			candidate := title[:idx]
			if looksLikeURL(candidate) {
				return candidate
			}
		}
	}
	return ""
}

// looksLikeURL returns true for strings that appear to be a URL.
func looksLikeURL(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 4 {
		return false
	}
	lower := strings.ToLower(s)
	return strings.HasPrefix(lower, "http://") ||
		strings.HasPrefix(lower, "https://") ||
		strings.HasPrefix(lower, "ftp://") ||
		strings.Contains(lower, "://")
}
