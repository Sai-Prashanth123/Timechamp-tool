//go:build windows

package capture

// On Windows, window title and app name access requires no special runtime permissions.
// UAC elevation is requested at install time via the tray manifest.

func CheckAndRequestPermissions() {}
func HasScreenRecording() bool    { return true }
func HasAccessibility() bool      { return true }
