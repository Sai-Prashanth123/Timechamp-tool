//go:build windows

package capture

import (
	"bytes"
	"fmt"
	"os/exec"
)

// CaptureCamera captures a single JPEG frame from the default webcam on Windows.
// Uses ffmpeg with DirectShow. Returns nil, error if camera unavailable or ffmpeg not found.
func CaptureCamera() ([]byte, error) {
	var out, errBuf bytes.Buffer
	cmd := exec.Command("ffmpeg",
		"-f", "dshow",
		"-i", "video=0",
		"-vframes", "1",
		"-vf", "scale=320:240",
		"-q:v", "10",
		"-f", "mjpeg",
		"-y",
		"pipe:1",
	)
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("camera capture failed: %w (stderr: %s)", err, errBuf.String())
	}
	return out.Bytes(), nil
}
