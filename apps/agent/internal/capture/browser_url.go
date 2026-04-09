package capture

import (
	"regexp"
	"strings"
	"sync/atomic"
)

// URLDetectionLayer tracks which layer last resolved a URL: 1=extension, 2=native, 3=title.
var URLDetectionLayer atomic.Int32

var knownBrowserBundles = map[string]bool{
	"com.google.Chrome": true, "com.apple.Safari": true, "org.mozilla.firefox": true,
	"com.microsoft.edgemac": true, "com.brave.Browser": true, "com.operasoftware.Opera": true,
	"com.vivaldi.Vivaldi": true, "company.thebrowser.Browser": true,
	"chrome": true, "msedge": true, "firefox": true, "brave": true,
}

// IsBrowser returns true if the window belongs to a known browser.
func IsBrowser(win ActiveWindow) bool {
	if win.BundleID != "" {
		return knownBrowserBundles[win.BundleID]
	}
	name := strings.ToLower(win.AppName)
	return strings.Contains(name, "chrome") || strings.Contains(name, "firefox") ||
		strings.Contains(name, "safari") || strings.Contains(name, "edge") ||
		strings.Contains(name, "brave") || strings.Contains(name, "opera") ||
		strings.Contains(name, "vivaldi") || strings.Contains(name, "arc")
}

// ResolveURL returns the best URL for the active window using 3 layers.
// Layer 1: browser extension cache. Layer 2: native URL (JXA/Win32) or Accessibility API.
// Layer 3: title parsing. Returns "" if not a browser or no URL found.
func ResolveURL(win ActiveWindow, extensionCache string) string {
	if !IsBrowser(win) {
		return ""
	}
	// Layer 1: native messaging extension cache (most accurate)
	if extensionCache != "" {
		URLDetectionLayer.Store(1)
		return extensionCache
	}
	// Layer 2a: URL already populated by JXA/Win32 native capture
	if win.URL != "" {
		URLDetectionLayer.Store(2)
		return win.URL
	}
	// Layer 2b: platform-specific Accessibility API scraping
	if url := scrapeURLViaAccessibility(win); url != "" {
		URLDetectionLayer.Store(2)
		return url
	}
	// Layer 3: window title parsing (always available, least accurate)
	if url := ExtractURLFromTitle(win.WindowTitle); url != "" {
		URLDetectionLayer.Store(3)
		return url
	}
	return ""
}

// ExtractURLFromTitle parses a browser window title to extract a domain (Layer 3).
func ExtractURLFromTitle(title string) string {
	parts := strings.Split(title, " - ")
	if len(parts) < 2 {
		parts = strings.Split(title, " — ")
	}
	if len(parts) < 2 {
		return ""
	}
	for i := len(parts) - 2; i >= 0; i-- {
		candidate := strings.TrimSpace(parts[i])
		if domain, ok := siteNameToDomain[strings.ToLower(candidate)]; ok {
			return domain
		}
		if domainPattern.MatchString(candidate) {
			return candidate
		}
	}
	return ""
}

var domainPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9\-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}`)

var siteNameToDomain = map[string]string{
	"github":     "github.com",
	"youtube":    "youtube.com",
	"google":     "google.com",
	"gmail":      "mail.google.com",
	"linkedin":   "linkedin.com",
	"twitter":    "twitter.com",
	"x":          "x.com",
	"facebook":   "facebook.com",
	"slack":      "app.slack.com",
	"notion":     "notion.so",
	"figma":      "figma.com",
	"jira":       "atlassian.net",
	"confluence": "atlassian.net",
}
