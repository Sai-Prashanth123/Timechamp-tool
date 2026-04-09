//go:build darwin

package capture

// scrapeURLViaAccessibility on macOS would use AXUIElement to read the browser address bar.
// win.URL is already populated by the JXA script (Layer 2 native), so this stub returns ""
// and lets win.URL serve as the native URL source.
// TODO: implement full AX scraping for browsers where JXA URL is unavailable.
func scrapeURLViaAccessibility(_ ActiveWindow) string {
	return ""
}
