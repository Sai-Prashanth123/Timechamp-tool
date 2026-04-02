package stream

import (
	"fmt"
	"os/exec"
	"runtime"
)

// RecordSession records the screen to an MP4 file for the specified duration.
// Returns error if ffmpeg is unavailable. Non-fatal — caller decides whether to surface the error.
func RecordSession(outputPath string, durationSec int) error {
	var cmd *exec.Cmd
	dur := fmt.Sprintf("%d", durationSec)
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("ffmpeg", "-f", "gdigrab", "-t", dur, "-i", "desktop", "-y", outputPath)
	case "darwin":
		cmd = exec.Command("ffmpeg", "-f", "avfoundation", "-t", dur, "-i", "1:none", "-y", outputPath)
	default:
		cmd = exec.Command("ffmpeg", "-f", "x11grab", "-t", dur, "-i", ":0.0", "-y", outputPath)
	}
	return cmd.Run()
}
