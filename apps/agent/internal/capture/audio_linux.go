//go:build linux

package capture

import (
	"bytes"
	"fmt"
	"os/exec"
)

func CaptureAudioChunk() ([]byte, error) {
	var out, errBuf bytes.Buffer
	cmd := exec.Command("ffmpeg",
		"-f", "alsa",
		"-i", "default",
		"-t", "1",
		"-ar", "16000",
		"-ac", "1",
		"-b:a", "16k",
		"-f", "opus",
		"-y",
		"pipe:1",
	)
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("audio capture failed: %w (stderr: %s)", err, errBuf.String())
	}
	return out.Bytes(), nil
}
