//go:build darwin

package capture

import (
	"os/exec"
	"strings"
)

// knownBrowserApps maps macOS application names to their AppleScript target name.
// This is the fallback path when JXA is unavailable.
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
	"chromium":       "Chromium",
}

// getBrowserURL extracts the current URL from the frontmost browser window.
// On macOS this is the AppleScript fallback; primary URL extraction happens in
// getActiveWindow() via the JXA script.
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
	case "Firefox", "Firefox Developer Edition", "Firefox Nightly":
		return "" // Firefox URL requires JXA or browser extension
	default:
		// Chromium-based
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
