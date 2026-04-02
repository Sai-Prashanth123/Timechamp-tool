//go:build linux

package capture

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CaptureScreenshot captures the primary display and saves it as a JPEG.
// On Linux it uses scrot(1) as the primary tool and falls back to
// ImageMagick import(1) when scrot is not installed.
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

	return path, nil
}
