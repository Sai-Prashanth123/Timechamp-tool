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
func CaptureScreenshot(dir string) (string, error) {
	bounds := screenshot.GetDisplayBounds(0)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		return "", fmt.Errorf("capture screen: %w", err)
	}

	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir screenshots: %w", err)
	}

	data, err := resizeAndEncode(img)
	if err != nil {
		return "", fmt.Errorf("encode jpeg: %w", err)
	}

	filename := fmt.Sprintf("ss_%d.jpg", time.Now().UnixMilli())
	path := filepath.Join(dir, filename)

	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	return path, nil
}
