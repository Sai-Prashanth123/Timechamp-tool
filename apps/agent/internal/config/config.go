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

	// StreamingEnabled controls whether the WebSocket streaming subsystem is active.
	StreamingEnabled bool

	// StreamingURL is the WebSocket URL of the streaming gateway.
	StreamingURL string

	// CameraEnabled enables webcam capture during full streaming sessions.
	CameraEnabled bool

	// AudioEnabled enables microphone capture during full streaming sessions.
	AudioEnabled bool

	// MaxStreamFPS is the maximum frames per second for screen streaming.
	MaxStreamFPS int
}

// Load reads configuration from environment variables, falling back to defaults.
func Load() *Config {
	return &Config{
		APIURL:             getEnv("TC_API_URL", "https://api.timechamp.io/api/v1"),
		OrgID:              getEnv("TC_ORG_ID", ""),
		ScreenshotInterval: getEnvPositiveInt("TC_SCREENSHOT_INTERVAL", 300),
		SyncInterval:       getEnvPositiveInt("TC_SYNC_INTERVAL", 30),
		IdleThreshold:      getEnvPositiveInt("TC_IDLE_THRESHOLD", 180),
		MaxBufferDays:      getEnvPositiveInt("TC_MAX_BUFFER_DAYS", 7),
		DataDir:            getEnv("TC_DATA_DIR", defaultDataDir()),
		StreamingEnabled:   getEnvBool("TC_STREAMING_ENABLED", false),
		StreamingURL:       getEnv("TC_STREAMING_URL", ""),
		CameraEnabled:      getEnvBool("TC_CAMERA_ENABLED", false),
		AudioEnabled:       getEnvBool("TC_AUDIO_ENABLED", false),
		MaxStreamFPS:       getEnvInt("TC_MAX_STREAM_FPS", 1),
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

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "true" || v == "1" {
		return true
	}
	if v == "false" || v == "0" {
		return false
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

// getEnvPositiveInt reads an integer env var and returns fallback if the value
// is missing, unparseable, or <= 0. Prevents panic from time.NewTicker(0/-n).
func getEnvPositiveInt(key string, fallback int) int {
	n := getEnvInt(key, fallback)
	if n <= 0 {
		return fallback
	}
	return n
}
