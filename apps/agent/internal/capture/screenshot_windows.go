//go:build windows

package capture

import (
	"bytes"
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"
	"time"

	"github.com/kbinani/screenshot"
)

// CaptureScreenshot captures the primary display and saves it as a JPEG.
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

	filename := fmt.Sprintf("ss_%d.jpg", time.Now().UnixMilli())
	path := filepath.Join(dir, filename)

	f, err := os.Create(path)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 75}); err != nil {
		return "", fmt.Errorf("encode jpeg: %w", err)
	}

	if _, err := f.Write(buf.Bytes()); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	return path, nil
}
