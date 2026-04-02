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

	// Primary: scrot  (-q sets JPEG quality 0-100)
	if err := exec.Command("scrot", "-q", "75", path).Run(); err != nil {
		// Fallback: ImageMagick import
		if err2 := exec.Command("import", "-window", "root", path).Run(); err2 != nil {
			return "", fmt.Errorf("scrot: %v; import (ImageMagick): %v", err, err2)
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
