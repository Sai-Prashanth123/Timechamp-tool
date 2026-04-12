//go:build windows

package capture

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kbinani/screenshot"
)

// CaptureScreenshot captures the primary display, resizes it to at most 1280 px
// on the longest side, and saves it as a JPEG at quality 60.
// On Windows it uses the kbinani/screenshot library (no CGo, pure Win32).
// Returns the local file path on success.
//
// Defends against the kbinani/screenshot library's nil-pointer panic on
// secure desktops (Windows lock screen, UAC elevation prompts, fast user
// switching). The library's BitBlt call returns NULL in those situations
// but it doesn't check for nil before dereferencing — we recover the panic
// and surface it as a normal error so the burst-capture loop can drop the
// frame instead of taking down the whole event loop case handler.
func CaptureScreenshot(dir string) (path string, err error) {
	defer func() {
		if r := recover(); r != nil {
			path = ""
			err = fmt.Errorf("capture screen: panic recovered (likely locked screen / secure desktop): %v", r)
		}
	}()

	bounds := screenshot.GetDisplayBounds(0)
	img, captureErr := screenshot.CaptureRect(bounds)
	if captureErr != nil {
		return "", fmt.Errorf("capture screen: %w", captureErr)
	}
	if img == nil {
		// Belt-and-braces guard for the same secure-desktop case in case
		// the upstream library is fixed to return (nil, nil) instead of
		// panicking.
		return "", fmt.Errorf("capture screen: library returned nil image (locked screen / secure desktop)")
	}

	if mkErr := os.MkdirAll(dir, 0700); mkErr != nil {
		return "", fmt.Errorf("mkdir screenshots: %w", mkErr)
	}

	data, encErr := resizeAndEncode(img)
	if encErr != nil {
		return "", fmt.Errorf("encode jpeg: %w", encErr)
	}

	filename := fmt.Sprintf("ss_%d.jpg", time.Now().UnixMilli())
	path = filepath.Join(dir, filename)

	if writeErr := os.WriteFile(path, data, 0600); writeErr != nil {
		return "", fmt.Errorf("write file: %w", writeErr)
	}

	return path, nil
}
