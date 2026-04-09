//go:build darwin

package capture

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// jxaGetWindowScript is a JavaScript for Automation (JXA) script that returns
// the frontmost application name, window title, browser URL, and incognito flag
// as a JSON string. JXA runs in the same osascript process as AppleScript but
// provides direct access to application objects and structured output.
//
// Architecture inspired by ActivityWatch aw-watcher-window macOS JXA strategy.
//
// Permissions required: Accessibility API (System Settings → Privacy → Accessibility)
const jxaGetWindowScript = `
var se = Application("System Events");
var procs = se.processes.whose({ frontmost: true });
if (procs.length === 0) {
    JSON.stringify({ app: "", title: "", url: "", incognito: false });
} else {
    var p = procs[0];
    var appName = p.displayedName();
    var title = "";
    var url = "";
    var incognito = false;

    // Try to get window title
    try {
        var wins = p.windows();
        if (wins.length > 0) {
            // Find main window (AXMain attribute)
            var mainWin = null;
            for (var i = 0; i < wins.length; i++) {
                try {
                    if (wins[i].attributes.byName("AXMain").value() === true) {
                        mainWin = wins[i];
                        break;
                    }
                } catch(e) {}
            }
            if (!mainWin && wins.length > 0) mainWin = wins[0];
            if (mainWin) {
                try { title = mainWin.attributes.byName("AXTitle").value(); } catch(e) {}
            }
        }
    } catch(e) {}

    // Browser-specific URL extraction
    try {
        var browserApp = Application(appName);
        switch(appName) {
            case "Google Chrome":
            case "Chromium":
            case "Brave Browser":
            case "Microsoft Edge":
            case "Vivaldi":
            case "Opera":
            case "Arc": {
                var win = browserApp.windows[0];
                url = win.activeTab().url();
                title = win.activeTab().name();
                try { incognito = (win.mode() === "incognito"); } catch(e) {}
                break;
            }
            case "Safari": {
                url = browserApp.documents[0].url();
                title = browserApp.documents[0].name();
                break;
            }
            case "Firefox":
            case "Firefox Developer Edition":
            case "Firefox Nightly": {
                // Firefox doesn't expose URL via JXA; get window name as title
                try { title = browserApp.windows[0].name(); } catch(e) {}
                break;
            }
        }
    } catch(e) {}

    var bundleId = "";
    try { bundleId = p.bundleIdentifier(); } catch(e) {}
    var pid = 0;
    try { pid = p.unixId(); } catch(e) {}
    JSON.stringify({ app: appName, title: title, url: url, incognito: incognito, bundle_id: bundleId, pid: pid });
}
`

// jxaWindowResult is the JSON shape returned by the JXA script.
type jxaWindowResult struct {
	App       string `json:"app"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Incognito bool   `json:"incognito"`
	BundleID  string `json:"bundle_id"`
	PID       int    `json:"pid"`
}

// getActiveWindow uses JXA (JavaScript for Automation) for high-fidelity window
// and browser URL data on macOS.
//
// JXA advantages over plain AppleScript (from ActivityWatch aw-watcher-window):
//   - Returns browser URL + incognito flag natively for Chrome, Edge, Brave, Arc, Safari
//   - Single subprocess invocation (no per-browser script spawning)
//   - Structured JSON output — no string parsing
//   - Locates main window via AXMain attribute for multi-window apps
// jxaTimeout is the maximum time we wait for osascript / System Events.
// A frozen or unresponsive app can cause osascript to block indefinitely.
const jxaTimeout = 5 * time.Second

func getActiveWindow() (ActiveWindow, error) {
	ctx, cancel := context.WithTimeout(context.Background(), jxaTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", jxaGetWindowScript)
	out, err := cmd.Output()
	if err != nil {
		// Accessibility permission not granted or System Events unavailable.
		// Fall back to basic approach so the main loop doesn't fail hard.
		return fallbackGetActiveWindow(), nil
	}

	line := strings.TrimSpace(string(out))
	if line == "" {
		return ActiveWindow{AppName: "Unknown"}, nil
	}

	var res jxaWindowResult
	if jsonErr := json.Unmarshal([]byte(line), &res); jsonErr != nil {
		return ActiveWindow{AppName: "Unknown"}, nil
	}

	if res.App == "" {
		return ActiveWindow{AppName: "Unknown"}, nil
	}

	url := res.URL
	// For non-browser apps try the native URL detector (checks AXDocument on the window).
	if url == "" {
		url = getBrowserURL(res.App)
	}

	title := res.Title
	if title == "" {
		title = res.App
	}

	return ActiveWindow{
		AppName:     res.App,
		WindowTitle: title,
		URL:         url,
		BundleID:    res.BundleID,
		PID:         res.PID,
	}, nil
}

// fallbackGetActiveWindow uses plain AppleScript when JXA / Accessibility is
// unavailable. Returns minimal data without browser URL.
func fallbackGetActiveWindow() ActiveWindow {
	script := `tell application "System Events"
		set frontApp to first application process whose frontmost is true
		set appName to name of frontApp
		set windowTitle to ""
		try
			set windowTitle to name of first window of frontApp
		end try
		return appName & "|" & windowTitle
	end tell`

	ctx, cancel := context.WithTimeout(context.Background(), jxaTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "osascript", "-e", script).Output()
	if err != nil {
		return ActiveWindow{AppName: "Unknown"}
	}

	line := strings.TrimSpace(string(out))
	parts := strings.SplitN(line, "|", 2)
	if len(parts) == 2 {
		return ActiveWindow{AppName: parts[0], WindowTitle: parts[1]}
	}
	return ActiveWindow{AppName: line}
}
