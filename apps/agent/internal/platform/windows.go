//go:build windows

package platform

import (
	"os"
	"path/filepath"
)

func dataDir() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
	}
	return filepath.Join(appData, "TimeChamp")
}
