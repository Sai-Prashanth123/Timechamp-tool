//go:build !darwin && !windows

package selfinstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// platformInstallBinary writes the binary to DataDir and returns its path.
// On Linux, users install via systemd user unit (separate flow); this stub
// covers any other GOOS that might appear.
func platformInstallBinary(cfg Config) (string, error) {
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", cfg.DataDir, err)
	}
	// This file is excluded from Windows builds by its build tag — no .exe suffix needed.
	dest := filepath.Join(cfg.DataDir, "timechamp-agent")
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, cfg.BinaryData, 0755); err != nil {
		return "", fmt.Errorf("write binary: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", err)
	}
	return dest, nil
}

// platformConfigureAutoStart is a no-op on non-darwin/non-windows platforms.
// Linux auto-start is handled via systemd user units in the separate installer CLI.
func platformConfigureAutoStart(binaryPath, apiURL string) (string, []string, error) {
	return "none", nil, nil
}

// platformStartAgent launches the agent detached from the current process.
func platformStartAgent(binaryPath, apiURL string) error {
	cmd := exec.Command(binaryPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	return cmd.Start()
}
