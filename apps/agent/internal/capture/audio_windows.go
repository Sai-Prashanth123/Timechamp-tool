//go:build windows

package capture

import (
	"bytes"
	"fmt"
	"os/exec"
)

// CaptureAudioChunk captures ~1 second of audio as an Opus-encoded chunk on Windows.
// Uses ffmpeg with DirectShow audio capture.
func CaptureAudioChunk() ([]byte, error) {
	var out, errBuf bytes.Buffer
	cmd := exec.Command("ffmpeg",
		"-f", "dshow",
		"-i", "audio=0",
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
