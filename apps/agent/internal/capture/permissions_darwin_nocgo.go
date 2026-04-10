//go:build darwin && !cgo

package capture

// Stub implementations for cross-compilation without CGO.
// When built natively on macOS with CGO enabled, permissions_darwin.go is used instead.

func CheckAndRequestPermissions() {}
func HasScreenRecording() bool    { return false }
func HasAccessibility() bool      { return false }
