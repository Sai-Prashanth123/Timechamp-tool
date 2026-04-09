package sync

import (
	"math/rand"
	"time"
)

// RetryConfig controls exponential backoff behaviour.
type RetryConfig struct {
	InitialInterval time.Duration // first sleep after failure
	MaxInterval     time.Duration // cap on sleep duration
	Multiplier      float64       // growth factor per attempt (must be ≥ 1.0)
	MaxElapsedTime  time.Duration // give up after this total time (0 = forever)
}

// DefaultRetry is the recommended config for agent → API sync.
var DefaultRetry = RetryConfig{
	InitialInterval: 2 * time.Second,
	MaxInterval:     5 * time.Minute,
	Multiplier:      2.0,
	MaxElapsedTime:  30 * time.Minute,
}

// isPermanentHTTPStatus returns true for HTTP status codes that should not be retried.
// 400/422 = bad payload (won't improve with retry), 401/403 = auth failure, 404 = not found.
func isPermanentHTTPStatus(code int) bool {
	return code == 400 || code == 401 || code == 403 || code == 404 || code == 422
}

// WithRetry calls fn repeatedly using full-jitter exponential backoff.
// fn should return (isPermanent, error). If isPermanent is true, retry stops immediately.
// If MaxElapsedTime > 0 and total time exceeds it, retry stops without sleeping over budget.
func WithRetry(cfg RetryConfig, fn func() (permanent bool, err error)) error {
	// Guard against degenerate configs that cause busy-spin.
	if cfg.InitialInterval <= 0 {
		cfg.InitialInterval = time.Second
	}
	if cfg.Multiplier < 1.0 {
		cfg.Multiplier = 1.0
	}

	interval := cfg.InitialInterval
	start := time.Now()

	for {
		permanent, err := fn()
		if err == nil {
			return nil
		}
		if permanent {
			return err
		}
		if cfg.MaxElapsedTime > 0 && time.Since(start) >= cfg.MaxElapsedTime {
			return err
		}
		// Full jitter: sleep uniformly in [0, interval], clamped to remaining budget.
		sleep := time.Duration(rand.Float64() * float64(interval))
		if cfg.MaxElapsedTime > 0 {
			remaining := cfg.MaxElapsedTime - time.Since(start)
			if remaining <= 0 {
				return err
			}
			if sleep > remaining {
				sleep = remaining
			}
		}
		time.Sleep(sleep)
		// Grow interval with cap.
		interval = min(time.Duration(float64(interval)*cfg.Multiplier), cfg.MaxInterval)
	}
}
