//go:build darwin

package platform

import (
	"os"
	"path/filepath"
)

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "TimeChamp")
}
