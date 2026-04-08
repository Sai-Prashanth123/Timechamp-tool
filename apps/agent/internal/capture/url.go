package capture

// GetBrowserURL attempts to extract the current URL from a known browser process.
// appName is the executable name (e.g. "chrome.exe", "Google Chrome").
// Returns empty string when no URL can be determined or the active app is not a browser.
func GetBrowserURL(appName string) string {
	return getBrowserURL(appName)
}
