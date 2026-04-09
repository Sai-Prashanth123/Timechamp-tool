package sync_test

import (
	"errors"
	"testing"
	"time"

	agentsync "github.com/timechamp/agent/internal/sync"
)

func TestWithRetry_SucceedsOnSecondAttempt(t *testing.T) {
	attempt := 0
	err := agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
		MaxElapsedTime:  1 * time.Second,
	}, func() (bool, error) {
		attempt++
		if attempt < 3 {
			return false, errors.New("transient error")
		}
		return false, nil
	})
	if err != nil {
		t.Fatalf("expected success, got: %v", err)
	}
	if attempt != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempt)
	}
}

func TestWithRetry_StopsOnPermanentError(t *testing.T) {
	attempt := 0
	err := agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 1 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
	}, func() (bool, error) {
		attempt++
		return true, errors.New("permanent error")
	})
	if err == nil {
		t.Fatal("expected error")
	}
	if attempt != 1 {
		t.Fatalf("expected 1 attempt, got %d", attempt)
	}
}

func TestWithRetry_RespectsMaxElapsedTime(t *testing.T) {
	start := time.Now()
	_ = agentsync.WithRetry(agentsync.RetryConfig{
		InitialInterval: 5 * time.Millisecond,
		MaxInterval:     10 * time.Millisecond,
		Multiplier:      2.0,
		MaxElapsedTime:  50 * time.Millisecond,
	}, func() (bool, error) {
		return false, errors.New("always fails")
	})
	elapsed := time.Since(start)
	if elapsed > 200*time.Millisecond {
		t.Fatalf("retry ran too long: %v", elapsed)
	}
}
