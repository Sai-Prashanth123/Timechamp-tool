//go:build linux

package platform

import (
	"os"
	"path/filepath"
)

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".local", "share", "timechamp")
}
