package config_test

import (
	"os"
	"testing"

	"github.com/timechamp/agent/internal/config"
)

func TestLoad_Defaults(t *testing.T) {
	os.Unsetenv("TC_API_URL")
	os.Unsetenv("TC_ORG_ID")
	os.Unsetenv("TC_SCREENSHOT_INTERVAL")

	cfg := config.Load()

	if cfg.APIURL != "https://timechamp-api-fgasejh3f0a7gxgk.eastasia-01.azurewebsites.net/api/v1" {
		t.Errorf("expected default API URL, got %q", cfg.APIURL)
	}
	if cfg.ScreenshotInterval != 300 {
		t.Errorf("expected default screenshot interval 300, got %d", cfg.ScreenshotInterval)
	}
	if cfg.SyncInterval != 30 {
		t.Errorf("expected default sync interval 30, got %d", cfg.SyncInterval)
	}
	if cfg.IdleThreshold != 180 {
		t.Errorf("expected default idle threshold 180, got %d", cfg.IdleThreshold)
	}
}

func TestLoad_FromEnv(t *testing.T) {
	os.Setenv("TC_API_URL", "http://localhost:3001/api/v1")
	os.Setenv("TC_SCREENSHOT_INTERVAL", "60")
	defer os.Unsetenv("TC_API_URL")
	defer os.Unsetenv("TC_SCREENSHOT_INTERVAL")

	cfg := config.Load()

	if cfg.APIURL != "http://localhost:3001/api/v1" {
		t.Errorf("expected env API URL, got %q", cfg.APIURL)
	}
	if cfg.ScreenshotInterval != 60 {
		t.Errorf("expected screenshot interval 60, got %d", cfg.ScreenshotInterval)
	}
}
