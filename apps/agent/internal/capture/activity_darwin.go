//go:build darwin

package capture

// getActiveWindow returns a stub on macOS (implement with CGo or osascript later).
func getActiveWindow() (ActiveWindow, error) {
	return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
}
