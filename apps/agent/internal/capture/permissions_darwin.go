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
import (
	"sync"
	"sync/atomic"
)

// PermissionState holds the current permission status.
type PermissionState struct {
	ScreenRecording atomic.Bool
	Accessibility   atomic.Bool
}

// GlobalPermissions is the singleton permission state checked by all capture functions.
var GlobalPermissions = &PermissionState{}

// accessibilityPrompted ensures we only ever show the Accessibility permission
// dialog once per agent run. Repeated calls with prompt=1 every 60 s would
// annoy users who have already made their choice.
var accessibilityPrompted sync.Once

// CheckAndRequestPermissions checks all permissions and prompts for missing ones.
// The Accessibility dialog is shown at most once per process lifetime.
// Screen recording status is re-checked on every call (no dialog, cheap syscall).
func CheckAndRequestPermissions() {
	GlobalPermissions.ScreenRecording.Store(C.hasScreenRecording() == 1)
	// Show the Accessibility dialog only on the first call. After the user
	// grants or denies, re-check silently (prompt=0) on every subsequent call.
	accessibilityPrompted.Do(func() {
		GlobalPermissions.Accessibility.Store(C.hasAccessibility(1) == 1)
	})
	if GlobalPermissions.Accessibility.Load() {
		return // already granted — no need to re-check
	}
	// Denied or not yet determined — re-check without prompting.
	GlobalPermissions.Accessibility.Store(C.hasAccessibility(0) == 1)
}

// HasScreenRecording returns true if the agent can capture screen content.
func HasScreenRecording() bool { return GlobalPermissions.ScreenRecording.Load() }

// HasAccessibility returns true if the agent can read window titles via AX API.
func HasAccessibility() bool { return GlobalPermissions.Accessibility.Load() }
