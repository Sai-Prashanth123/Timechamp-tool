package capture

// ActiveWindow holds info about the currently focused application window.
type ActiveWindow struct {
	AppName     string
	WindowTitle string
	URL         string // populated by browser extension hook (future); empty for now
	BundleID    string // macOS only — e.g. com.apple.Safari, com.google.Chrome
	PID         int    // macOS only — process ID for AX API scraping
}

// GetActiveWindow returns the currently focused window info.
// The implementation is OS-specific — see platform files.
func GetActiveWindow() (ActiveWindow, error) {
	return getActiveWindow()
}
