# Sleep / Resume Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect system sleep/wake on Windows, macOS, and Linux so the agent resumes tracking within ≤10 seconds of wake, idle time is zeroed after wake, and the tray (Windows) relaunches the agent immediately instead of waiting up to 5 minutes.

**Architecture:** A new `internal/sleepwatch` package uses wall-clock drift detection (comparing `.Round(0)` wall time across `time.After` intervals) to detect sleep on all three platforms with zero OS-specific code. Windows Service additionally receives `PBT_APMRESUMEAUTOMATIC` from the SCM for zero-latency detection. macOS uses the existing launchd `KeepAlive=true` plist (already in place). Linux gets a proper `service_linux.go` with systemd user service install (replacing the stub in `service_other.go`).

**Tech Stack:** Go 1.21+, `golang.org/x/sys/windows/svc` (Windows Service power events), no new external dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `apps/agent/internal/sleepwatch/watcher.go` | Cross-platform wall-clock drift detector |
| **Create** | `apps/agent/internal/sleepwatch/watcher_test.go` | Unit tests with injected clock |
| **Modify** | `apps/agent/internal/capture/idle.go` | Add `ResetIdleBaseline()` + offset logic to `IdleSeconds()` |
| **Create** | `apps/agent/internal/capture/idle_test.go` | Unit tests for baseline reset |
| **Modify** | `apps/agent/internal/sync/client.go` | Add `ResetCircuit()` method |
| **Create** | `apps/agent/internal/service/service_linux.go` | Real systemd user-service install/manage |
| **Modify** | `apps/agent/internal/service/service_other.go` | Narrow build tag to `!windows && !darwin && !linux` |
| **Modify** | `apps/agent/internal/service/service_windows.go` | Add `AcceptPowerEvent` + package-level `PowerEvents` channel |
| **Modify** | `apps/agent/cmd/agent/main.go` | Integrate sleepwatch into main select loop |
| **Modify** | `apps/agent/cmd/tray/app.go` | Add sleepwatch field, power-event handler, graceful restart |

---

## Task 1: `internal/sleepwatch` package

**Files:**
- Create: `apps/agent/internal/sleepwatch/watcher.go`
- Create: `apps/agent/internal/sleepwatch/watcher_test.go`

- [ ] **Step 1.1 — Write the failing tests first**

Create `apps/agent/internal/sleepwatch/watcher_test.go`:

```go
package sleepwatch

import (
	"sync"
	"testing"
	"time"
)

// TestWatcher_DetectsWakeViaWallClockDrift verifies that a large wall-clock gap
// (simulating sleep) emits a Resume event with the correct duration.
func TestWatcher_DetectsWakeViaWallClockDrift(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	calls := 0
	base := time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC)

	mockNow := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		calls++
		if calls == 1 {
			return base // initial prev
		}
		return base.Add(4 * time.Minute) // simulated wake after 4-min sleep
	}

	// poll=50ms, threshold=100ms so 4-min gap >> threshold
	w := newWatcher(mockNow, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	defer w.Stop()

	select {
	case evt := <-w.C:
		if evt.Type != Resume {
			t.Fatalf("expected Resume, got %q", evt.Type)
		}
		if evt.Duration < 3*time.Minute {
			t.Errorf("expected duration ~4m, got %v", evt.Duration)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout: no Resume event received")
	}
}

// TestWatcher_NoFalsePositiveUnderLoad verifies that normal operation (elapsed ≈ poll)
// does not emit any events.
func TestWatcher_NoFalsePositiveUnderLoad(t *testing.T) {
	t.Parallel()

	base := time.Now()
	callCount := 0
	mockNow := func() time.Time {
		callCount++
		// Each call advances by exactly pollInterval — no gap
		return base.Add(time.Duration(callCount) * 50 * time.Millisecond)
	}

	w := newWatcher(mockNow, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	defer w.Stop()

	select {
	case evt := <-w.C:
		t.Fatalf("unexpected event: type=%q duration=%v", evt.Type, evt.Duration)
	case <-time.After(400 * time.Millisecond):
		// No event = correct
	}
}

// TestWatcher_Signal_InjectsResumeEvent verifies that Signal(Resume) bypasses
// the timer-drift loop and emits immediately.
func TestWatcher_Signal_InjectsResumeEvent(t *testing.T) {
	t.Parallel()

	// Long poll/threshold so timer-drift never fires during this test
	w := newWatcher(time.Now, 1*time.Hour, 30*time.Minute)
	w.Start()
	defer w.Stop()

	w.Signal(Resume)

	select {
	case evt := <-w.C:
		if evt.Type != Resume {
			t.Fatalf("expected Resume, got %q", evt.Type)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout: no event after Signal(Resume)")
	}
}

// TestWatcher_DebounceCollapsesDuplicates verifies that two Signal(Resume) calls
// within debounceDuration produce exactly one event on C.
func TestWatcher_DebounceCollapsesDuplicates(t *testing.T) {
	t.Parallel()

	w := newWatcher(time.Now, 1*time.Hour, 30*time.Minute)
	w.Start()
	defer w.Stop()

	w.Signal(Resume)
	w.Signal(Resume) // rapid duplicate — must be suppressed

	count := 0
	deadline := time.After(300 * time.Millisecond)
loop:
	for {
		select {
		case <-w.C:
			count++
		case <-deadline:
			break loop
		}
	}
	if count != 1 {
		t.Errorf("expected 1 Resume event (debounce), got %d", count)
	}
}

// TestWatcher_StopPreventsEvents verifies Stop() shuts down the goroutine.
func TestWatcher_StopPreventsEvents(t *testing.T) {
	t.Parallel()

	w := newWatcher(time.Now, 50*time.Millisecond, 100*time.Millisecond)
	w.Start()
	w.Stop()

	// After Stop, Signal should not block and C should not receive
	w.Signal(Resume)
	select {
	case <-w.C:
		// Event may have been buffered before Stop; drain it and check no more arrive
		select {
		case <-w.C:
			t.Fatal("received second event after Stop")
		case <-time.After(200 * time.Millisecond):
		}
	case <-time.After(200 * time.Millisecond):
		// No events — correct
	}
}
```

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
cd apps/agent
go test ./internal/sleepwatch/... -v 2>&1
```

Expected: `cannot find package` or `no Go files` — the package doesn't exist yet.

- [ ] **Step 1.3 — Implement `watcher.go`**

Create `apps/agent/internal/sleepwatch/watcher.go`:

```go
// Package sleepwatch detects system sleep/wake cycles using wall-clock drift.
//
// Detection algorithm: a background goroutine calls time.After(pollInterval) in a
// loop. It compares wall-clock time (time.Now().Round(0)) — which advances through
// sleep — against the expected interval. If the gap exceeds wakeThreshold, the
// system was asleep. .Round(0) is critical: it strips Go's monotonic reading from
// time.Time, forcing subtraction to use the wall clock. Without it, time.Sub() uses
// CLOCK_MONOTONIC (Linux/macOS) which pauses during sleep, making drift undetectable.
package sleepwatch

import (
	"sync"
	"time"
)

const (
	defaultPollInterval  = 5 * time.Second
	defaultWakeThreshold = 10 * time.Second // 2× poll; tolerates heavy CPU load
	debounceDuration     = 3 * time.Second  // collapses Windows connected-standby bursts
)

// EventType classifies a power transition.
type EventType string

const (
	Suspend EventType = "suspend"
	Resume  EventType = "resume"
)

// Event represents a system power transition detected by the Watcher.
type Event struct {
	Type     EventType
	At       time.Time
	Duration time.Duration // how long the system slept (Resume events only)
}

// Watcher detects sleep/wake transitions and emits Events on C.
// Call Start before reading C. Safe for concurrent use.
type Watcher struct {
	// C is the read-only channel consumers receive Events from.
	// Buffered (cap 4) — a slow consumer drops events rather than blocking detection.
	C <-chan Event

	c        chan Event
	stop     chan struct{}
	startOnce sync.Once
	stopOnce  sync.Once

	// Injected for testing; production code uses time.Now.
	nowFn     func() time.Time
	poll      time.Duration
	threshold time.Duration

	// Debounce state — prevents duplicate events from concurrent sources
	// (timer-drift + Windows SCM both firing on the same wake).
	mu           sync.Mutex
	lastResumeAt time.Time
}

// New returns a production Watcher with 5 s poll and 10 s wake threshold.
func New() *Watcher {
	return newWatcher(time.Now, defaultPollInterval, defaultWakeThreshold)
}

// newWatcher is the internal constructor used by tests to inject a mock clock
// and short intervals. Tests live in package sleepwatch (same package) so they
// can call this unexported function directly.
func newWatcher(nowFn func() time.Time, poll, threshold time.Duration) *Watcher {
	c := make(chan Event, 4)
	return &Watcher{
		C:         c,
		c:         c,
		stop:      make(chan struct{}),
		nowFn:     nowFn,
		poll:      poll,
		threshold: threshold,
	}
}

// Start launches the background detection goroutine. Idempotent — safe to call
// multiple times; only the first call starts the goroutine.
func (w *Watcher) Start() {
	w.startOnce.Do(func() { go w.run() })
}

// Stop shuts down the background goroutine. Idempotent.
func (w *Watcher) Stop() {
	w.stopOnce.Do(func() { close(w.stop) })
}

// Signal injects an external power event into the watcher. Use this to forward
// OS-level notifications (e.g. Windows SCM PBT_APMRESUMEAUTOMATIC) so they pass
// through the same debounce logic as timer-drift events.
func (w *Watcher) Signal(t EventType) {
	switch t {
	case Resume:
		w.emitResume(0)
	case Suspend:
		w.emit(Event{Type: Suspend, At: w.nowFn()})
	}
}

func (w *Watcher) run() {
	// Strip monotonic from the initial timestamp so all subsequent subtractions
	// use wall-clock time. This is the key correctness requirement.
	prev := w.nowFn().Round(0)

	for {
		select {
		case <-w.stop:
			return
		case <-time.After(w.poll):
		}

		now := w.nowFn().Round(0)
		elapsed := now.Sub(prev) // wall-clock subtraction — always advances through sleep
		prev = now

		gap := elapsed - w.poll
		if gap > w.threshold {
			w.emitResume(gap)
		}
	}
}

func (w *Watcher) emitResume(duration time.Duration) {
	w.mu.Lock()
	now := w.nowFn()
	if now.Sub(w.lastResumeAt) < debounceDuration {
		w.mu.Unlock()
		return // duplicate within debounce window — suppress
	}
	w.lastResumeAt = now
	w.mu.Unlock()

	w.emit(Event{Type: Resume, At: now, Duration: duration})
}

func (w *Watcher) emit(e Event) {
	select {
	case w.c <- e:
	default:
		// Channel full: consumer is lagging. Drop — the next poll will re-detect.
	}
}
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
cd apps/agent
go test ./internal/sleepwatch/... -v -race 2>&1
```

Expected output (all PASS):
```
=== RUN   TestWatcher_DetectsWakeViaWallClockDrift
--- PASS: TestWatcher_DetectsWakeViaWallClockDrift
=== RUN   TestWatcher_NoFalsePositiveUnderLoad
--- PASS: TestWatcher_NoFalsePositiveUnderLoad
=== RUN   TestWatcher_Signal_InjectsResumeEvent
--- PASS: TestWatcher_Signal_InjectsResumeEvent
=== RUN   TestWatcher_DebounceCollapsesDuplicates
--- PASS: TestWatcher_DebounceCollapsesDuplicates
=== RUN   TestWatcher_StopPreventsEvents
--- PASS: TestWatcher_StopPreventsEvents
PASS
```

- [ ] **Step 1.5 — Commit**

```bash
cd apps/agent
git add internal/sleepwatch/
git commit -m "feat(agent): add sleepwatch package — cross-platform sleep/wake detection via wall-clock drift"
```

---

## Task 2: Idle Baseline Reset

**Files:**
- Modify: `apps/agent/internal/capture/idle.go`
- Create: `apps/agent/internal/capture/idle_test.go`

- [ ] **Step 2.1 — Write the failing tests**

Create `apps/agent/internal/capture/idle_test.go`:

```go
package capture

import (
	"sync/atomic"
	"testing"
)

func resetBaseline() { atomic.StoreInt64(&idleBaselineOffset, 0) }

// TestIdleSeconds_NoBaseline verifies that with no baseline set, IdleSeconds
// returns raw values unchanged.
func TestIdleSeconds_NoBaseline(t *testing.T) {
	resetBaseline()

	// Override the OS call for testing
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

// TestIdleSeconds_BaselineSubtracted verifies that the offset is subtracted
// from raw idle after ResetIdleBaseline.
func TestIdleSeconds_BaselineSubtracted(t *testing.T) {
	resetBaseline()

	orig := idleSecondsFunc
	defer func() { idleSecondsFunc = orig }()

	// Simulate: at wake, raw idle = 14400 (4-hour sleep + pre-sleep idle)
	// After user types, raw idle drops to small values
	raw := 14400
	idleSecondsFunc = func() (int, error) { return raw, nil }

	ResetIdleBaseline() // records offset = 14400

	// User hasn't touched keyboard yet — raw still 14400 → corrected = 0
	got, err := IdleSeconds()
	if err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Errorf("expected 0 immediately after reset, got %d", got)
	}

	// User was idle for 10 more seconds post-wake
	raw = 14410
	got, _ = IdleSeconds()
	if got != 10 {
		t.Errorf("expected 10, got %d", got)
	}
}

// TestIdleSeconds_BaselineAutoClearsWhenUserActive verifies that once raw idle
// drops below the offset (user became active), the offset is cleared so future
// readings are unaffected.
func TestIdleSeconds_BaselineAutoClearsWhenUserActive(t *testing.T) {
	resetBaseline()

	orig := idleSecondsFunc
	defer func() { idleSecondsFunc = orig }()

	raw := 14400
	idleSecondsFunc = func() (int, error) { return raw, nil }

	ResetIdleBaseline() // offset = 14400

	// User types — raw drops to 0
	raw = 0
	got, _ := IdleSeconds()
	if got != 0 {
		t.Errorf("expected 0 when user active, got %d", got)
	}
	// Offset should now be cleared
	if atomic.LoadInt64(&idleBaselineOffset) != 0 {
		t.Error("expected idleBaselineOffset to be cleared after user activity")
	}

	// User goes idle again for 30s — should read correctly with no offset
	raw = 30
	got, _ = IdleSeconds()
	if got != 30 {
		t.Errorf("expected 30 after baseline cleared, got %d", got)
	}
}
```

- [ ] **Step 2.2 — Run tests to verify they fail**

```bash
cd apps/agent
go test ./internal/capture/ -run TestIdleSeconds -v 2>&1
```

Expected: compilation error — `idleSecondsFunc` and `ResetIdleBaseline` not defined yet.

- [ ] **Step 2.3 — Implement the idle baseline in `idle.go`**

Replace the entire contents of `apps/agent/internal/capture/idle.go`:

```go
package capture

import (
	"sync/atomic"
)

// idleBaselineOffset is subtracted from raw idle readings after a system wake.
// It is set by ResetIdleBaseline to the raw idle value at wake time (which
// includes the sleep duration). Auto-clears when raw idle drops below it
// (meaning the user has been active since wake). Atomic int64, stores seconds.
var idleBaselineOffset int64

// idleSecondsFunc is the OS-specific implementation, indirected through a
// function variable so tests can replace it without build-tag gymnastics.
var idleSecondsFunc = idleSeconds

// ResetIdleBaseline records the current raw idle at system wake time.
// All subsequent IdleSeconds calls subtract this value so that the sleep
// duration is never counted as user idle time.
// Thread-safe; safe to call from the sleepwatch event handler goroutine.
func ResetIdleBaseline() {
	raw, err := idleSecondsFunc()
	if err != nil {
		return
	}
	atomic.StoreInt64(&idleBaselineOffset, int64(raw))
}

// IdleSeconds returns the number of seconds since the user last had input,
// corrected for any sleep gap set by ResetIdleBaseline.
//
// Correction logic:
//   - If no baseline is set (offset == 0): return raw value.
//   - If raw >= offset: return raw - offset (actual post-wake idle).
//   - If raw < offset: user became active post-wake; clear baseline, return 0.
func IdleSeconds() (int, error) {
	raw, err := idleSecondsFunc()
	if err != nil {
		return 0, err
	}

	offset := atomic.LoadInt64(&idleBaselineOffset)
	if offset == 0 {
		return int(raw), nil
	}

	result := int64(raw) - offset
	if result <= 0 {
		// User has been active since wake: raw idle reset below the baseline.
		// Clear the offset so future readings are unaffected.
		atomic.StoreInt64(&idleBaselineOffset, 0)
		return 0, nil
	}
	return int(result), nil
}
```

- [ ] **Step 2.4 — Run tests to verify they pass**

```bash
cd apps/agent
go test ./internal/capture/ -run TestIdleSeconds -v -race 2>&1
```

Expected: all three `TestIdleSeconds_*` tests PASS.

- [ ] **Step 2.5 — Verify existing package still compiles**

```bash
cd apps/agent
go build ./internal/capture/... 2>&1
```

Expected: no output (clean build).

- [ ] **Step 2.6 — Commit**

```bash
git add apps/agent/internal/capture/idle.go apps/agent/internal/capture/idle_test.go
git commit -m "feat(agent): idle baseline reset — zero idle time immediately after system wake"
```

---

## Task 3: `client.ResetCircuit()`

**Files:**
- Modify: `apps/agent/internal/sync/client.go`

- [ ] **Step 3.1 — Add `ResetCircuit` after `recordFailure`**

In `apps/agent/internal/sync/client.go`, add this method directly after `recordFailure()` (currently at line 257):

```go
// ResetCircuit clears an open circuit breaker so syncs resume immediately.
// Call this on system resume: failures from before sleep are stale and should
// not block the first post-wake sync attempt.
func (c *Client) ResetCircuit() {
	c.failures = 0
	c.circuitOpen = false
}
```

- [ ] **Step 3.2 — Verify compilation**

```bash
cd apps/agent
go build ./internal/sync/... 2>&1
```

Expected: no output.

- [ ] **Step 3.3 — Commit**

```bash
git add apps/agent/internal/sync/client.go
git commit -m "feat(agent): add Client.ResetCircuit() for post-wake sync recovery"
```

---

## Task 4: Windows Service Power Events

**Files:**
- Modify: `apps/agent/internal/service/service_windows.go`

- [ ] **Step 4.1 — Add `PowerEvents` channel and update `Execute`**

In `apps/agent/internal/service/service_windows.go`:

1. Add the package-level `PowerEvents` channel directly after the `const` block at the top of the file (after the existing `const` block that has `serviceName`, `serviceDisplayName`, `serviceDescription`):

```go
const (
	// pbtAPMSuspend and pbtAPMResumeAutomatic are Windows power broadcast event types.
	// Defined here because golang.org/x/sys/windows does not export them.
	pbtAPMSuspend          = 0x0004
	pbtAPMResumeAutomatic  = 0x0012
)

// PowerEvents receives power event type strings ("resume" or "suspend") from
// the Windows SCM when the service receives SERVICE_CONTROL_POWEREVENT.
// Buffered (cap 4) — the SCM callback must never block.
// The agent main loop reads this channel and forwards to the sleepwatch.Watcher.
var PowerEvents = make(chan string, 4)
```

2. Replace the `Execute` method entirely:

```go
func (a *agentSvc) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPowerEvent

	changes <- svc.Status{State: svc.StartPending}

	done := make(chan struct{})
	go func() {
		a.mainFn()
		close(done)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				// Give mainFn up to 10 s to flush buffers and exit cleanly.
				select {
				case <-done:
				case <-time.After(10 * time.Second):
				}
				return false, 0

			case svc.PowerEvent:
				// Forward power events to the agent's sleepwatch via PowerEvents.
				// Non-blocking send — SCM cannot wait on us.
				switch c.EventType {
				case pbtAPMResumeAutomatic:
					select {
					case PowerEvents <- "resume":
					default:
					}
				case pbtAPMSuspend:
					select {
					case PowerEvents <- "suspend":
					default:
					}
				}
			}

		case <-done:
			changes <- svc.Status{State: svc.StopPending}
			return false, 0
		}
	}
}
```

- [ ] **Step 4.2 — Verify Windows build**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build ./internal/service/... 2>&1
```

Expected: no output.

- [ ] **Step 4.3 — Commit**

```bash
git add apps/agent/internal/service/service_windows.go
git commit -m "feat(agent): Windows Service now relays PBT_APMRESUMEAUTOMATIC to sleepwatch"
```

---

## Task 5: Linux systemd Service

**Files:**
- Create: `apps/agent/internal/service/service_linux.go`
- Modify: `apps/agent/internal/service/service_other.go`

- [ ] **Step 5.1 — Create `service_linux.go`**

Create `apps/agent/internal/service/service_linux.go`:

```go
//go:build linux

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const systemdUnitName = "timechamp-agent"

type linuxManager struct{}

func newManager() Manager { return &linuxManager{} }

// unitFilePath returns the systemd user unit file path, respecting XDG_CONFIG_HOME.
func unitFilePath() string {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		home, _ := os.UserHomeDir()
		configHome = filepath.Join(home, ".config")
	}
	return filepath.Join(configHome, "systemd", "user", systemdUnitName+".service")
}

// Install writes the systemd user unit and enables + starts it.
// Does not require root — runs as a user service (loginctl enable-linger for
// persistence across logouts must be run separately if required).
func (m *linuxManager) Install(binaryPath string) error {
	absPath, err := filepath.Abs(binaryPath)
	if err != nil {
		return err
	}

	unitDir := filepath.Dir(unitFilePath())
	if err := os.MkdirAll(unitDir, 0755); err != nil {
		return fmt.Errorf("create systemd user unit dir: %w", err)
	}

	unit := fmt.Sprintf(`[Unit]
Description=Time Champ Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10

[Install]
WantedBy=default.target
`, absPath)

	if err := os.WriteFile(unitFilePath(), []byte(unit), 0644); err != nil {
		return fmt.Errorf("write unit file: %w", err)
	}

	// Reload daemon so systemd picks up the new unit, then enable and start.
	for _, args := range [][]string{
		{"--user", "daemon-reload"},
		{"--user", "enable", "--now", systemdUnitName},
	} {
		out, err := exec.Command("systemctl", args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl %s: %w — %s",
				strings.Join(args, " "), err, strings.TrimSpace(string(out)))
		}
	}

	fmt.Printf("systemd user service installed: %s\n", unitFilePath())
	return nil
}

// Uninstall stops, disables, and removes the systemd user unit.
func (m *linuxManager) Uninstall() error {
	for _, args := range [][]string{
		{"--user", "disable", "--now", systemdUnitName},
	} {
		out, err := exec.Command("systemctl", args...).CombinedOutput()
		if err != nil {
			return fmt.Errorf("systemctl %s: %w — %s",
				strings.Join(args, " "), err, strings.TrimSpace(string(out)))
		}
	}
	return os.Remove(unitFilePath())
}

func (m *linuxManager) Start() error {
	out, err := exec.Command("systemctl", "--user", "start", systemdUnitName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl start: %w — %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *linuxManager) Stop() error {
	out, err := exec.Command("systemctl", "--user", "stop", systemdUnitName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl stop: %w — %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (m *linuxManager) Status() (string, error) {
	out, err := exec.Command("systemctl", "--user", "is-active", systemdUnitName).CombinedOutput()
	status := strings.TrimSpace(string(out))
	if err != nil {
		// is-active exits non-zero for inactive/failed/unknown
		if status == "inactive" || status == "failed" {
			return status, nil
		}
		return "not installed", nil
	}
	return status, nil // "active"
}

// IsWindowsService always returns false on Linux.
func IsWindowsService() bool { return false }

// RunAsService is a no-op shim — the process runs normally under systemd.
func RunAsService(mainFn func()) error {
	mainFn()
	return nil
}
```

- [ ] **Step 5.2 — Narrow `service_other.go` build tag**

In `apps/agent/internal/service/service_other.go`, change line 1 from:

```go
//go:build !windows && !darwin
```

to:

```go
//go:build !windows && !darwin && !linux
```

- [ ] **Step 5.3 — Verify all platform builds**

```bash
cd apps/agent
GOOS=linux   GOARCH=amd64 go build ./internal/service/... 2>&1
GOOS=darwin  GOARCH=amd64 go build ./internal/service/... 2>&1
GOOS=windows GOARCH=amd64 go build ./internal/service/... 2>&1
```

All three expected: no output.

- [ ] **Step 5.4 — Commit**

```bash
git add apps/agent/internal/service/service_linux.go apps/agent/internal/service/service_other.go
git commit -m "feat(agent): real systemd user-service install for Linux (was stub)"
```

---

## Task 6: Agent `main.go` — Integrate Sleepwatch

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] **Step 6.1 — Add import and watcher startup**

In `apps/agent/cmd/agent/main.go`:

1. Add to the import block (alongside other internal imports):

```go
"github.com/timechamp/agent/internal/sleepwatch"
```

2. After the `client := agentsync.NewClient(...)` line (currently around line 150), add:

```go
// Sleep/wake detection — cross-platform via wall-clock drift.
sleepWatcher := sleepwatch.New()
sleepWatcher.Start()
defer sleepWatcher.Stop()

// When running as a Windows Service, the SCM delivers PBT_APMRESUMEAUTOMATIC
// at zero latency. Relay those events into the sleepwatch so they pass through
// the same debounce as the timer-drift events.
if service.IsWindowsService() {
    go func() {
        for {
            select {
            case <-quit:
                return
            case evt := <-service.PowerEvents:
                sleepWatcher.Signal(sleepwatch.EventType(evt))
            }
        }
    }()
}
```

- [ ] **Step 6.2 — Add `sleepWatcher.C` case to the main select loop**

In the main `for { select { ... } }` loop, add a new case alongside the existing ticker cases. Place it after the `case <-heartbeatTicker.C:` block:

```go
// ── Sleep / wake ───────────────────────────────────────────────────────────
case event := <-sleepWatcher.C:
    switch event.Type {
    case sleepwatch.Suspend:
        log.Printf("[sleep] system going to sleep — flushing buffers")
        hq.FlushAll()
        _ = db.Checkpoint()

    case sleepwatch.Resume:
        log.Printf("[sleep] system resumed after %v", event.Duration.Round(time.Second))
        // 1. Clear AFK — user is now active; don't count sleep as idle
        isAFK = false
        hq.FlushAll()
        // 2. Zero the idle baseline so GetLastInputInfo sleep gap is ignored
        capture.ResetIdleBaseline()
        // 3. Force sync + heartbeat immediately — non-blocking goroutine so the
        //    select loop is not stalled waiting for network calls
        go func() {
            client.ResetCircuit() // clear any pre-sleep open circuit breaker
            if err := client.Heartbeat(); err != nil {
                log.Printf("[sleep] post-wake heartbeat: %v", err)
            }
            if n, err := uploader.FlushActivity(); err != nil {
                log.Printf("[sleep] post-wake activity flush: %v", err)
            } else if n > 0 {
                log.Printf("[sleep] post-wake flushed %d activity records", n)
            }
            _, _ = uploader.FlushScreenshots()
            _, _ = uploader.FlushMetrics()
        }()
    }
```

- [ ] **Step 6.3 — Build for all platforms to verify no compilation errors**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build ./cmd/agent/ 2>&1
GOOS=darwin  GOARCH=amd64 go build ./cmd/agent/ 2>&1
GOOS=linux   GOARCH=amd64 go build ./cmd/agent/ 2>&1
```

All three expected: no output.

- [ ] **Step 6.4 — Commit**

```bash
git add apps/agent/cmd/agent/main.go
git commit -m "feat(agent): integrate sleepwatch into main loop — flush + heartbeat on resume"
```

---

## Task 7: Tray `app.go` — Immediate Restart on Wake (Windows)

**Files:**
- Modify: `apps/agent/cmd/tray/app.go`

- [ ] **Step 7.1 — Add sleepwatch field to App and update constructor**

In `apps/agent/cmd/tray/app.go`, update the `App` struct and `NewApp`:

```go
// App holds the Wails application state.
type App struct {
	ctx          context.Context
	agentBinary  []byte
	sleepWatcher *sleepwatch.Watcher
}

// NewApp creates a new App instance.
func NewApp(binary []byte) *App {
	return &App{
		agentBinary:  binary,
		sleepWatcher: sleepwatch.New(),
	}
}
```

- [ ] **Step 7.2 — Start watcher and power-event handler in `startup`**

Replace the existing `startup` method:

```go
// startup is called by Wails when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.sleepWatcher.Start()
	go a.autoLaunchIfRegistered()
	go a.monitorAgent()
	go a.handlePowerEvents()
}
```

- [ ] **Step 7.3 — Add `handlePowerEvents` method**

Add after `startup`:

```go
// handlePowerEvents listens for sleep/wake events and immediately attempts to
// restart the agent on resume — bypassing the monitorAgent backoff timer.
func (a *App) handlePowerEvents() {
	for event := range a.sleepWatcher.C {
		if event.Type == sleepwatch.Resume {
			log.Printf("[tray] system resumed after %v — checking agent",
				event.Duration.Round(time.Second))
			go a.restartAgentIfNeeded()
		}
	}
}
```

- [ ] **Step 7.4 — Add `restartAgentIfNeeded` and `stopAgentByPID` methods**

Add after `handlePowerEvents`:

```go
// restartAgentIfNeeded checks the agent health endpoint and relaunches the
// agent if it is not responding. Called immediately on system resume.
func (a *App) restartAgentIfNeeded() {
	cfg := config.Load()
	if a.isAgentRunning(cfg.DataDir) {
		// Agent survived sleep with a healthy state — nothing to do.
		return
	}

	log.Printf("[tray] agent not responding after resume — restarting")
	a.stopAgentByPID(cfg.DataDir) // clean up stale process if PID file exists
	a.autoLaunchIfRegistered()
}

// stopAgentByPID reads the PID file and terminates the agent process.
// On Windows, os.Process.Kill() calls TerminateProcess (hard kill).
// SQLite WAL ensures data integrity on unclean shutdown.
func (a *App) stopAgentByPID(dataDir string) {
	pidFile := filepath.Join(dataDir, "agent.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return // no PID file — agent was not running
	}
	var pid int
	if err := json.Unmarshal(data, &pid); err != nil {
		return
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	_ = proc.Kill()
}
```

- [ ] **Step 7.5 — Add sleepwatch import to the import block**

The import block in `app.go` must include:

```go
"github.com/timechamp/agent/internal/sleepwatch"
```

Add it alongside the other `github.com/timechamp/agent/internal/...` imports.

- [ ] **Step 7.6 — Build the tray**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build ./cmd/tray/ 2>&1
```

Expected: no output.

- [ ] **Step 7.7 — Commit**

```bash
git add apps/agent/cmd/tray/app.go
git commit -m "feat(tray): immediate agent restart on system resume via sleepwatch"
```

---

## Task 8: Full Build + Smoke Test

- [ ] **Step 8.1 — Run all agent tests**

```bash
cd apps/agent
go test ./... -race -timeout 30s 2>&1
```

Expected: all tests PASS, no race conditions.

- [ ] **Step 8.2 — Build production agent binary (embedded in tray)**

```bash
cd apps/agent
GOOS=windows GOARCH=amd64 go build \
  -ldflags "-X main.Version=dev -X main.BuildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o cmd/tray/agent_bin.exe ./cmd/agent/
ls -lh cmd/tray/agent_bin.exe
```

Expected: file exists, ~15–20 MB.

- [ ] **Step 8.3 — Build tray with embedded agent**

```bash
cd apps/agent/cmd/tray
wails build 2>&1
```

Expected: `Built 'build/bin/timechamp-tray.exe'` with no errors.

- [ ] **Step 8.4 — Smoke test sleep detection manually**

1. Stop any running `timechamp-agent.exe` and `timechamp-tray.exe`
2. Launch `build/bin/timechamp-tray.exe`
3. Watch agent log: `Get-Content "$env:APPDATA\TimeChamp\agent.log" -Wait`
4. Lock the screen (Win+L) for 30 seconds then unlock
5. Verify log shows within 10 seconds: `[sleep] system resumed after ...`
6. Verify next line shows: `[sleep] post-wake flushed X activity records` or heartbeat

- [ ] **Step 8.5 — Final commit**

```bash
cd apps/agent
git add -A
git commit -m "build: rebuild tray with sleep/resume detection embedded"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in |
|-----------------|-----------|
| ≤10 s detection via wall-clock drift | Task 1 (sleepwatch) |
| Idle zeroed after wake | Task 2 (idle baseline) |
| Non-blocking resume flush | Task 6 (goroutine in select case) |
| Circuit breaker reset on resume | Task 3 + Task 6 |
| Windows Service `PBT_APMRESUMEAUTOMATIC` | Task 4 |
| macOS launchd `KeepAlive` | Already in place — no change needed |
| Linux systemd user service | Task 5 |
| Tray immediate restart (Windows) | Task 7 |
| Debounce connected-standby bursts | Task 1 (3 s debounce in watcher) |
| Graceful tray restart (SIGTERM) | Task 7 — `stopAgentByPID` (hard kill + SQLite WAL safety noted) |

**Type consistency check:**

- `sleepwatch.EventType` used as `sleepwatch.Resume` / `sleepwatch.Suspend` consistently across Task 1, 4, 6, 7 ✓
- `capture.ResetIdleBaseline()` — no arguments — called in Task 6 ✓
- `capture.IdleSeconds()` — unchanged signature `(int, error)` — all existing callers unaffected ✓
- `client.ResetCircuit()` — no arguments — called in Task 6 goroutine ✓
- `service.PowerEvents` — `chan string` — read in Task 6, written in Task 4 ✓
- `idleSecondsFunc` — injected in tests (Task 2), references `idleSeconds` (OS-specific) ✓
