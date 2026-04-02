//go:build linux

package capture

import (
	"bytes"
	"fmt"
	"os/exec"
)

func CaptureCamera() ([]byte, error) {
	var out, errBuf bytes.Buffer
	cmd := exec.Command("ffmpeg",
		"-f", "v4l2",
		"-i", "/dev/video0",
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
