//go:build linux

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
// On Linux it uses scrot(1) as the primary tool and falls back to
// ImageMagick import(1) when scrot is not installed, then re-encodes the
// result through the shared resize pipeline.
// Returns the local file path on success.
func CaptureScreenshot(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir screenshots: %w", err)
	}

	filename := fmt.Sprintf("ss_%d.jpg", time.Now().UnixMilli())
	path := filepath.Join(dir, filename)

	// Detect available screenshot tool before attempting capture.
	// This gives a clear error instead of a cryptic exec failure.
	scrotPath, scrotErr := exec.LookPath("scrot")
	importPath, importErr := exec.LookPath("import") // ImageMagick

	if scrotErr != nil && importErr != nil {
		return "", fmt.Errorf("no screenshot tool found: install scrot (apt install scrot) or imagemagick (apt install imagemagick)")
	}

	// Primary: scrot (-q sets JPEG quality 0-100)
	captured := false
	if scrotErr == nil {
		if err := exec.Command(scrotPath, "-q", "75", path).Run(); err == nil {
			captured = true
		}
	}

	// Fallback: ImageMagick import
	if !captured {
		if importErr != nil {
			return "", fmt.Errorf("scrot unavailable and imagemagick not installed")
		}
		if err := exec.Command(importPath, "-window", "root", path).Run(); err != nil {
			return "", fmt.Errorf("import (ImageMagick) failed: %w", err)
		}
	}

	// Decode the file the tool wrote, resize, and re-encode at Q60.
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open screenshot: %w", err)
	}
	img, err := jpeg.Decode(f)
	f.Close()
	if err != nil {
		os.Remove(path) // clean up partial file
		return "", fmt.Errorf("decode screenshot: %w", err)
	}

	data, err := resizeAndEncode(img)
	if err != nil {
		os.Remove(path)
		return "", fmt.Errorf("encode jpeg: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	return path, nil
}
