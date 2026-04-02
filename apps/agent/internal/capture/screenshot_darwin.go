//go:build darwin

package capture

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CaptureScreenshot captures the primary display and saves it as a JPEG.
// On macOS it delegates to the built-in screencapture(1) CLI so that no
// CGo or Quartz bindings are required at compile time.
// Returns the local file path on success.
func CaptureScreenshot(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir screenshots: %w", err)
	}

	filename := fmt.Sprintf("ss_%d.jpg", time.Now().UnixMilli())
	path := filepath.Join(dir, filename)

	// -x  suppress camera shutter sound
	// -t jpg  JPEG output format
	// screencapture writes to the path given as the last argument
	cmd := exec.Command("screencapture", "-x", "-t", "jpg", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("screencapture: %w — %s", err, out)
	}

	return path, nil
}
