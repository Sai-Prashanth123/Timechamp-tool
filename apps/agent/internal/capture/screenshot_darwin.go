//go:build darwin

package capture

import (
	"fmt"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CaptureScreenshot captures the primary display, resizes it to at most 1280 px
// on the longest side, and saves it as a JPEG at quality 60.
// On macOS it delegates to the built-in screencapture(1) CLI so that no
// CGo or Quartz bindings are required at compile time, then re-encodes the
// result through the shared resize pipeline.
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

	// Decode the file screencapture wrote, resize, and re-encode at Q60.
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open screenshot: %w", err)
	}
	img, err := jpeg.Decode(f)
	f.Close()
	if err != nil {
		return "", fmt.Errorf("decode screenshot: %w", err)
	}

	data, err := resizeAndEncode(img)
	if err != nil {
		return "", fmt.Errorf("encode jpeg: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	return path, nil
}
