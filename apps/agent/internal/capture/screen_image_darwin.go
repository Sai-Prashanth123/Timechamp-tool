//go:build darwin

package capture

import (
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"os/exec"
)

// CaptureScreenImage captures the primary display and returns it as image.Image.
// Used by the streaming subsystem for delta encoding.
func CaptureScreenImage() (image.Image, error) {
	f, err := os.CreateTemp("", "stream_*.jpg")
	if err != nil {
		return nil, fmt.Errorf("temp file: %w", err)
	}
	tmpPath := f.Name()
	f.Close()
	defer os.Remove(tmpPath)

	cmd := exec.Command("screencapture", "-x", "-t", "jpg", tmpPath)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("screencapture: %w — %s", err, out)
	}

	fh, err := os.Open(tmpPath)
	if err != nil {
		return nil, fmt.Errorf("open screenshot: %w", err)
	}
	defer fh.Close()

	img, err := jpeg.Decode(fh)
	if err != nil {
		return nil, fmt.Errorf("decode screenshot: %w", err)
	}
	return img, nil
}
