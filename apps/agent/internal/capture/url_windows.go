//go:build windows

package capture

import (
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// knownBrowsers maps lowercase exe names to display names.
var knownBrowsers = map[string]bool{
	"chrome.exe":         true,
	"msedge.exe":         true,
	"firefox.exe":        true,
	"brave.exe":          true,
	"opera.exe":          true,
	"vivaldi.exe":        true,
	"iexplore.exe":       true,
	"microsoftedgecp.exe": true,
}

// omniboxClasses are the window class names used by browser address bars.
var omniboxClasses = []string{
	"Chrome_OmniboxView",    // Chrome, Edge (Chromium), Brave, Vivaldi, Opera
	"MozillaWindowClass",    // Firefox — we read the window's URL bar child
	"Edit",                  // IE / generic
}

var (
	enumChildWindowsProc = user32.NewProc("EnumChildWindows")
	getClassNameProc     = user32.NewProc("GetClassNameW")
	sendMessageProc      = user32.NewProc("SendMessageW")
	isWindowVisibleProc  = user32.NewProc("IsWindowVisible")
)

const (
	wmGetText       = 0x000D
	wmGetTextLength = 0x000E
)

// childSearchState is passed via EnumChildWindows callback to accumulate the URL.
type childSearchState struct {
	url string
}

// getBrowserURL extracts the current URL from the foreground browser window.
// It enumerates child windows looking for the address bar control.
func getBrowserURL(appName string) string {
	lower := strings.ToLower(appName)
	if !knownBrowsers[lower] {
		// strip path, keep basename
		if idx := strings.LastIndexAny(lower, `/\`); idx >= 0 {
			lower = lower[idx+1:]
		}
		if !knownBrowsers[lower] {
			return ""
		}
	}

	hwnd, _, _ := getForegroundWindow.Call()
	if hwnd == 0 {
		return ""
	}

	// For Firefox, the window class is MozillaWindowClass; we query the URL
	// differently (title parsing fallback) since its address bar is in a native
	// XUL widget that doesn't expose via simple WM_GETTEXT.
	if lower == "firefox.exe" {
		return firefoxURLFromTitle(hwnd)
	}

	// For Chromium-based browsers, find Chrome_OmniboxView child.
	state := &childSearchState{}
	cb := syscall.NewCallback(func(child uintptr, lParam uintptr) uintptr {
		if extractIfOmnibox(child, state) {
			return 0 // stop enumeration
		}
		return 1 // continue
	})

	enumChildWindowsProc.Call(hwnd, cb, uintptr(unsafe.Pointer(state)))
	return state.url
}

// extractIfOmnibox checks if child is the omnibox; if so, reads its text.
// Returns true when the URL was found.
func extractIfOmnibox(hwnd uintptr, state *childSearchState) bool {
	// Check visibility
	vis, _, _ := isWindowVisibleProc.Call(hwnd)
	if vis == 0 {
		return false
	}

	// Get class name
	classBuf := make([]uint16, 256)
	getClassNameProc.Call(hwnd, uintptr(unsafe.Pointer(&classBuf[0])), 256)
	className := syscall.UTF16ToString(classBuf)

	for _, want := range omniboxClasses {
		if strings.EqualFold(className, want) {
			url := windowText(hwnd)
			if looksLikeURL(url) {
				state.url = normalizeURL(url)
				return true
			}
		}
	}
	return false
}

// windowText sends WM_GETTEXT to retrieve the text of a window.
func windowText(hwnd uintptr) string {
	length, _, _ := sendMessageProc.Call(hwnd, wmGetTextLength, 0, 0)
	if length == 0 {
		return ""
	}
	buf := make([]uint16, length+1)
	sendMessageProc.Call(hwnd, wmGetText, length+1, uintptr(unsafe.Pointer(&buf[0])))
	return syscall.UTF16ToString(buf)
}

// firefoxURLFromTitle extracts the URL from the Firefox window title.
// Firefox shows "Page Title — Mozilla Firefox" or "url — Mozilla Firefox".
func firefoxURLFromTitle(hwnd uintptr) string {
	titleLen, _, _ := getWindowTextLength.Call(hwnd)
	if titleLen == 0 {
		return ""
	}
	buf := make([]uint16, titleLen+1)
	getWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	title := syscall.UTF16ToString(buf)

	// Remove " — Mozilla Firefox" or " - Mozilla Firefox" suffix
	for _, suffix := range []string{" — Mozilla Firefox", " - Mozilla Firefox", " – Mozilla Firefox"} {
		if idx := strings.LastIndex(title, suffix); idx > 0 {
			candidate := title[:idx]
			if looksLikeURL(candidate) {
				return normalizeURL(candidate)
			}
			return "" // title found but not a URL, don't return junk
		}
	}
	return ""
}

// looksLikeURL returns true for strings that appear to be a URL or domain.
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

// normalizeURL ensures the URL has a scheme prefix.
func normalizeURL(s string) string {
	s = strings.TrimSpace(s)
	if !strings.Contains(s, "://") {
		return "https://" + s
	}
	return s
}

// ensure windows import is used
var _ = windows.Handle(0)
