package capture

import (
	"sync/atomic"
	"testing"
)

func resetBaseline() { atomic.StoreInt64(&idleBaselineOffset, 0) }

func TestIdleSeconds_NoBaseline(t *testing.T) {
	resetBaseline()
	orig := idleSecondsFunc
	defer func() { idleSecondsFunc = orig }()
	idleSecondsFunc = func() (int, error) { return 120, nil }

	got, err := IdleSeconds()
	if err != nil {
		t.Fatal(err)
	}
	if got != 120 {
		t.Errorf("expected 120, got %d", got)
	}
}

func TestIdleSeconds_BaselineSubtracted(t *testing.T) {
	resetBaseline()
	orig := idleSecondsFunc
	defer func() { idleSecondsFunc = orig }()

	raw := 14400
	idleSecondsFunc = func() (int, error) { return raw, nil }

	ResetIdleBaseline()

	got, err := IdleSeconds()
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Errorf("expected 0 immediately after reset, got %d", got)
	}

	raw = 14410
	got, _ = IdleSeconds()
	if got != 10 {
		t.Errorf("expected 10, got %d", got)
	}
}

func TestIdleSeconds_BaselineAutoClearsWhenUserActive(t *testing.T) {
	resetBaseline()
	orig := idleSecondsFunc
	defer func() { idleSecondsFunc = orig }()

	raw := 14400
	idleSecondsFunc = func() (int, error) { return raw, nil }

	ResetIdleBaseline()

	raw = 0
	got, _ := IdleSeconds()
	if got != 0 {
		t.Errorf("expected 0 when user active, got %d", got)
	}
	if atomic.LoadInt64(&idleBaselineOffset) != 0 {
		t.Error("expected idleBaselineOffset to be cleared after user activity")
	}

	raw = 30
	got, _ = IdleSeconds()
	if got != 30 {
		t.Errorf("expected 30 after baseline cleared, got %d", got)
	}
}
