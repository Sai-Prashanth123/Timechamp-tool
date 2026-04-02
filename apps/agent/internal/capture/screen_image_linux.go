//go:build linux

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

	if err := exec.Command("scrot", "-q", "75", tmpPath).Run(); err != nil {
		if err2 := exec.Command("import", "-window", "root", tmpPath).Run(); err2 != nil {
			return nil, fmt.Errorf("scrot: %v; import (ImageMagick): %v", err, err2)
		}
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
