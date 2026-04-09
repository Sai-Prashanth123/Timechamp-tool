//go:build windows

package capture

// scrapeURLViaAccessibility on Windows would use UI Automation COM interfaces to read
// the browser address bar. For now returns "" — rely on Layer 1 (extension) and Layer 3 (title).
// TODO: implement via github.com/go-ole/go-ole + IUIAutomation
func scrapeURLViaAccessibility(_ ActiveWindow) string {
	return ""
}
