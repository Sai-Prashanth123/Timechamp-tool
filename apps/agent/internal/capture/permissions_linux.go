//go:build linux

package capture

// On Linux, X11 window access requires no special runtime permissions.
// Wayland restricts window listing by design — fallback methods are used.

func CheckAndRequestPermissions() {}
func HasScreenRecording() bool    { return true }
func HasAccessibility() bool      { return true }
