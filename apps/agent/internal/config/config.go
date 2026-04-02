package config

import (
	"os"
	"strconv"

	"github.com/timechamp/agent/internal/platform"
)

// Config holds all runtime configuration for the agent.
type Config struct {
	// APIURL is the base URL of the TimeChamp API.
	APIURL string

	// OrgID is the organization this agent belongs to.
	OrgID string

	// EmployeeID is this agent's employee identifier.
	EmployeeID string

	// ScreenshotInterval is how often (seconds) to capture a screenshot.
	ScreenshotInterval int

	// SyncInterval is how often (seconds) to flush the local buffer to the API.
	SyncInterval int

	// IdleThreshold is how many seconds of inactivity before marking idle.
	IdleThreshold int

	// MaxBufferDays is how many days of data to retain locally before pruning.
	MaxBufferDays int

	// DataDir is where the SQLite database is stored.
	DataDir string
}

// Load reads configuration from environment variables, falling back to defaults.
func Load() *Config {
	return &Config{
		APIURL:             getEnv("TC_API_URL", "https://api.timechamp.io/api/v1"),
		OrgID:              getEnv("TC_ORG_ID", ""),
		ScreenshotInterval: getEnvInt("TC_SCREENSHOT_INTERVAL", 300),
		SyncInterval:       getEnvInt("TC_SYNC_INTERVAL", 30),
		IdleThreshold:      getEnvInt("TC_IDLE_THRESHOLD", 180),
		MaxBufferDays:      getEnvInt("TC_MAX_BUFFER_DAYS", 7),
		DataDir:            getEnv("TC_DATA_DIR", defaultDataDir()),
	}
}

func defaultDataDir() string {
	return platform.DataDir()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}
