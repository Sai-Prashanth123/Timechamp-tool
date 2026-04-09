//go:build darwin

package capture

/*
#cgo LDFLAGS: -framework ApplicationServices -framework CoreGraphics
#include <ApplicationServices/ApplicationServices.h>
#include <CoreGraphics/CoreGraphics.h>

// Returns 1 if screen recording permission is granted, 0 otherwise.
int hasScreenRecording() {
    return CGPreflightScreenCaptureAccess() ? 1 : 0;
}

// Returns 1 if accessibility is trusted, 0 otherwise.
// If prompt=1, shows the system dialog asking the user to grant access.
int hasAccessibility(int prompt) {
    NSDictionary *options = @{(id)kAXTrustedCheckOptionPrompt: @(prompt)};
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options) ? 1 : 0;
}
*/
import "C"
import "sync/atomic"

// PermissionState holds the current permission status.
type PermissionState struct {
	ScreenRecording atomic.Bool
	Accessibility   atomic.Bool
}

// GlobalPermissions is the singleton permission state checked by all capture functions.
var GlobalPermissions = &PermissionState{}

// CheckAndRequestPermissions checks all permissions and prompts for missing ones.
// Safe to call from multiple goroutines and repeatedly (re-checks current state).
func CheckAndRequestPermissions() {
	GlobalPermissions.ScreenRecording.Store(C.hasScreenRecording() == 1)
	// Accessibility: prompt=1 shows "TimeChamp wants to control this computer" dialog on first call.
	GlobalPermissions.Accessibility.Store(C.hasAccessibility(1) == 1)
}

// HasScreenRecording returns true if the agent can capture screen content.
func HasScreenRecording() bool { return GlobalPermissions.ScreenRecording.Load() }

// HasAccessibility returns true if the agent can read window titles via AX API.
func HasAccessibility() bool { return GlobalPermissions.Accessibility.Load() }
