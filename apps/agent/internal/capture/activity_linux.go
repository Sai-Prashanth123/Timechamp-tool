//go:build linux

package capture

// getActiveWindow returns a stub on Linux (implement with xdotool/wnck later).
func getActiveWindow() (ActiveWindow, error) {
	return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
}
