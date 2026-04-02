//go:build windows

package capture

import (
	"fmt"
	"image"

	"github.com/kbinani/screenshot"
)

// CaptureScreenImage captures the primary display and returns it as image.Image.
// Used by the streaming subsystem for delta encoding.
func CaptureScreenImage() (image.Image, error) {
	bounds := screenshot.GetDisplayBounds(0)
	img, err := screenshot.CaptureRect(bounds)
	if err != nil {
		return nil, fmt.Errorf("capture screen: %w", err)
	}
	return img, nil
}
