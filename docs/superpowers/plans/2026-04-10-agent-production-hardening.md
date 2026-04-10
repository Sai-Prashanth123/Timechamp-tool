# Agent Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 15 confirmed reliability bugs and implement 8 architectural improvements to make the TimeChamp agent production-grade in accuracy, performance, and crash resilience.

**Architecture:** Two layers — surgical per-file bug fixes first (Tasks 1–10), then architectural improvements (Tasks 11–18). Each task is independently committable. The agent must build clean on all platforms after every task.

**Tech Stack:** Go 1.22, `golang.org/x/sys/windows`, `modernc.org/sqlite`, `sync`, `atomic`, build tags (`//go:build windows`, `//go:build darwin`, `//go:build !darwin && !windows`)

---

## File Structure

```
apps/agent/
├── cmd/agent/main.go                          MODIFY — panic recovery, registration retry, idle median, screenshot worker, adaptive sync, shutdown
├── internal/sync/client.go                    MODIFY — mutex + half-open circuit breaker
├── internal/sync/client_test.go               CREATE — circuit breaker concurrency + half-open tests
├── internal/sync/uploader.go                  MODIFY — screenshot orphan guard, 422 permanent error
├── internal/sync/uploader_test.go             MODIFY — add missing file test
├── internal/capture/metrics_windows.go        MODIFY — metricsCollector struct, NTSTATUS check, 4-sample ring
├── internal/capture/metrics_windows_test.go   CREATE — syscall failure test
├── internal/capture/activity_windows.go       MODIFY — replace wmic, 800ms cap, SetWinEventHook
├── internal/capture/idle_windows.go           MODIFY — 24h spike filter, atomic lastKnownIdleSec
├── internal/capture/idle_windows_test.go      CREATE — wraparound + median tests
├── internal/heartbeat/merge.go                MODIFY — 1-hour event duration cap
├── internal/heartbeat/merge_test.go           MODIFY — add hour cap test
├── internal/telemetry/crash.go                MODIFY — add ReportGoroutinePanic method
├── internal/buffer/db.go                      MODIFY — DroppedEvents counter, Checkpoint timeout, autocheckpoint=200
├── internal/buffer/batcher.go                 CREATE — 5s write batcher
├── internal/buffer/batcher_test.go            CREATE — batcher flush tests
├── internal/classifier/classifier.go          MODIFY — add LRU cache wrapper
├── internal/classifier/classifier_test.go     CREATE — cache hit/miss test
├── internal/stream/manager.go                 MODIFY — self-healing reconnect, log send errors
```

---

## Tasks

### Task 1: Thread-safe circuit breaker with half-open state

**Files:**
- Modify: `apps/agent/internal/sync/client.go`
- Create: `apps/agent/internal/sync/client_test.go`

- [ ] Step 1: Read `internal/sync/client.go` and identify all fields (`failures int`, `openedAt time.Time`, `circuitOpen bool`) and all methods that touch them (`recordFailure()`, `IsAvailable()`, any inline resets).
- [ ] Step 2: Create `internal/sync/client_test.go` with the following content exactly:

```go
package sync

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestCircuitBreakerConcurrency(t *testing.T) {
	var mu sync.Mutex
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		n := callCount
		mu.Unlock()
		if n%2 == 0 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = c.Post("/agent/sync/heartbeat", struct{}{})
		}()
	}
	wg.Wait()
	// If no race: test passes. Run with -race flag.
}

func TestCircuitBreakerHalfOpen(t *testing.T) {
	attempts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts <= 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	c.resetTimeout = 50 * time.Millisecond // speed up for test

	// Trip the circuit (3 failures)
	for range 3 {
		_ = c.Post("/agent/sync/heartbeat", struct{}{})
	}
	if c.IsAvailable() {
		t.Fatal("circuit should be open after 3 failures")
	}

	// Wait for reset timeout → half-open
	time.Sleep(100 * time.Millisecond)
	if !c.IsAvailable() {
		t.Fatal("circuit should be half-open after reset timeout")
	}

	// Probe succeeds → closed
	_ = c.Post("/agent/sync/heartbeat", struct{}{})
	if !c.IsAvailable() {
		t.Fatal("circuit should be closed after successful probe")
	}
}
```

- [ ] Step 3: Define a `circuitState` type and constants in `client.go`:

```go
type circuitState int

const (
	stateClosed  circuitState = 0
	stateOpen    circuitState = 1
	stateHalfOpen circuitState = 2
)
```

- [ ] Step 4: Update the `Client` struct in `client.go` — remove bare `circuitOpen bool`, `failures int`, `openedAt time.Time`; add:

```go
mu           sync.Mutex
state        circuitState
failures     int        // guarded by mu
openedAt     time.Time  // guarded by mu
resetTimeout time.Duration
```

- [ ] Step 5: Rewrite `IsAvailable()` with mutex and half-open logic:

```go
func (c *Client) IsAvailable() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case stateClosed:
		return true
	case stateOpen:
		if time.Since(c.openedAt) >= c.resetTimeout {
			c.state = stateHalfOpen
			return true // allow one probe
		}
		return false
	case stateHalfOpen:
		return false // only one probe allowed; still waiting for recordSuccess
	}
	return true
}
```

- [ ] Step 6: Rewrite `recordFailure()` with exponential backoff and cap:

```go
func (c *Client) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures++
	if c.failures >= 3 || c.state == stateHalfOpen {
		if c.state == stateHalfOpen {
			// double the timeout on probe failure
			c.resetTimeout *= 2
			if c.resetTimeout > time.Hour {
				c.resetTimeout = time.Hour
			}
		}
		c.state = stateOpen
		c.openedAt = time.Now()
	}
}
```

- [ ] Step 7: Add `recordSuccess()` (rename from any inline `c.failures = 0; c.circuitOpen = false`):

```go
func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = stateClosed
	c.failures = 0
	c.resetTimeout = 5 * time.Minute
}
```

- [ ] Step 8: Update `ResetCircuit()` to use mutex:

```go
func (c *Client) ResetCircuit() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state = stateClosed
	c.failures = 0
	c.resetTimeout = 5 * time.Minute
}
```

- [ ] Step 9: Update `NewClient()` to initialize `resetTimeout`:

```go
resetTimeout: 5 * time.Minute,
```

- [ ] Step 10: Ensure all call sites that previously set `c.circuitOpen = false` or `c.failures = 0` directly now call `c.recordSuccess()` or `c.recordFailure()`.

- [ ] Step 11: Run `go test -race ./internal/sync/... -run TestCircuit` — expect PASS with zero race warnings.

- [ ] Step 12: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/sync/client.go apps/agent/internal/sync/client_test.go
git -C "D:/Time champ-agent" commit -m "fix(sync): thread-safe circuit breaker with half-open state"
```

---

### Task 2: telemetry.ReportGoroutinePanic + withRecover helper

**Files:**
- Modify: `apps/agent/internal/telemetry/crash.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `internal/telemetry/crash.go` to find the `Reporter` struct and the `CrashReport` struct and `send()` method.

- [ ] Step 2: Add `ReportGoroutinePanic` to `crash.go` immediately after the existing `Report()` method:

```go
// ReportGoroutinePanic sends a crash report for a panic caught in a background
// goroutine or select-case handler. Non-blocking best-effort: will not stall shutdown.
func (r *Reporter) ReportGoroutinePanic(goroutineName string, value any, stack []byte) {
	report := CrashReport{
		AgentVersion: r.version,
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		OrgID:        r.orgID,
		EmployeeID:   r.employeeID,
		ErrorType:    "goroutine_panic",
		Message:      fmt.Sprintf("[%s] %v", goroutineName, value),
		StackTrace:   string(stack),
		UptimeSec:    int64(time.Since(r.startedAt).Seconds()),
		ReportedAt:   time.Now().UTC(),
	}
	// Fire-and-forget in a goroutine — must not block the caller.
	go r.send(report)
}
```

- [ ] Step 3: Add `withRecover` helper in `cmd/agent/main.go` (after imports, before `main()`):

```go
// withRecover wraps fn so a panic inside it is caught, reported to the crash
// API, and logged — but does NOT terminate the main event loop.
func withRecover(name string, cr *telemetry.Reporter, fn func()) {
	defer func() {
		if v := recover(); v != nil {
			buf := make([]byte, 16384)
			n := runtime.Stack(buf, false)
			log.Printf("PANIC in %s: %v\n%s", name, v, buf[:n])
			cr.ReportGoroutinePanic(name, v, buf[:n])
		}
	}()
	fn()
}
```

- [ ] Step 4: Add or update `safeGo` in `cmd/agent/main.go`:

```go
func safeGo(name string, cr *telemetry.Reporter, fn func()) {
	go func() {
		defer func() {
			if v := recover(); v != nil {
				buf := make([]byte, 16384)
				n := runtime.Stack(buf, false)
				log.Printf("PANIC in goroutine %s: %v\n%s", name, v, buf[:n])
				cr.ReportGoroutinePanic(name, v, buf[:n])
			}
		}()
		fn()
	}()
}
```

- [ ] Step 5: In the main event loop `select`, wrap each case body with `withRecover("case-name", crashReporter, func() { ... })`. For example:

```go
case <-heartbeatTicker.C:
	withRecover("heartbeat-tick", crashReporter, func() {
		// ... existing heartbeat logic ...
	})
case <-syncTicker.C:
	withRecover("sync-tick", crashReporter, func() {
		// ... existing sync logic ...
	})
```

Apply `withRecover` to every select case in the main event loop.

- [ ] Step 6: Ensure `runtime` is imported in both files.

- [ ] Step 7: Run `go build ./cmd/agent/...` — expect no output.

- [ ] Step 8: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/telemetry/crash.go apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "fix(telemetry): report goroutine panics to API + per-case panic recovery"
```

---

### Task 3: Registration retry with keychain fallback

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `cmd/agent/main.go` and find the `Register()` call inside `run()`. Note what variables it assigns (`agentToken`, `employeeID`, `orgID`, or equivalent).

- [ ] Step 2: Replace the single `Register()` call with the retry loop:

```go
const maxRegAttempts = 5
var (
	agentToken string
	employeeID string
	orgID      string
	regErr     error
)
for i := range maxRegAttempts {
	if i > 0 {
		wait := time.Duration(10*(1<<uint(i))) * time.Second
		log.Printf("[agent] registration attempt %d/%d — retrying in %s", i+1, maxRegAttempts, wait)
		time.Sleep(wait)
	}
	agentToken, employeeID, orgID, regErr = agentsync.Register(
		cfg.APIURL, inviteToken, hostname, runtime.GOOS, osVersion(),
	)
	if regErr == nil {
		break
	}
	log.Printf("[agent] registration failed (attempt %d/%d): %v", i+1, maxRegAttempts, regErr)
}
if regErr != nil {
	// Fallback: if previously registered, use saved token and identity
	savedToken, tokenErr := keychain.LoadToken()
	if tokenErr != nil || savedToken == "" {
		log.Fatalf("[agent] registration failed after %d attempts and no saved token: %v", maxRegAttempts, regErr)
	}
	agentToken = savedToken
	identity, idErr := config.LoadIdentity(cfg.DataDir)
	if idErr != nil {
		log.Fatalf("[agent] registration failed and cannot load identity: %v", idErr)
	}
	orgID = identity.OrgID
	employeeID = identity.EmployeeID
	log.Printf("[agent] using existing keychain token (API unreachable at startup)")
}
```

- [ ] Step 3: Verify that `keychain` and `config` packages are already imported; add imports if missing.

- [ ] Step 4: Adjust variable usage below the block — any downstream code that reads `agentToken`, `employeeID`, `orgID` continues to work because the variables are declared before the loop.

- [ ] Step 5: Run `go build ./cmd/agent/...` — expect no output.

- [ ] Step 6: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "fix(agent): retry registration with keychain fallback on API down"
```

---

### Task 4: Thread-safe metricsCollector + NTSTATUS error check

**Files:**
- Modify: `apps/agent/internal/capture/metrics_windows.go`
- Create: `apps/agent/internal/capture/metrics_windows_test.go`

- [ ] Step 1: Read `internal/capture/metrics_windows.go` to find the existing `GetSystemMetrics()` function, the `NtQuerySystemInformation` syscall invocation, and all field accesses.

- [ ] Step 2: Create `internal/capture/metrics_windows_test.go`:

```go
//go:build windows

package capture

import "testing"

func TestMetricsSyscallFailure(t *testing.T) {
	// Inject a forced failure into the collector
	c := &metricsCollector{}
	// Manually set lastValid to a known value
	c.lastValid = SystemMetrics{CPUPercent: 42.0, MemUsedMB: 1024, MemTotalMB: 8192}

	// When syscall returns non-zero NTSTATUS, collect() must return lastValid.
	// We test this by verifying the public fallback() method returns the stored value.
	result := c.fallback()
	if result.CPUPercent != 42.0 {
		t.Errorf("expected fallback CPU=42.0, got %f", result.CPUPercent)
	}
	if result.MemUsedMB != 1024 {
		t.Errorf("expected fallback MemUsedMB=1024, got %d", result.MemUsedMB)
	}
}
```

- [ ] Step 3: Define the `metricsCollector` struct in `metrics_windows.go`:

```go
type metricsCollector struct {
	mu        sync.Mutex
	lastIdle  int64
	lastTotal int64
	lastRead  time.Time
	lastValid SystemMetrics
	// 4-sample ring buffer for amortization (used by Task 5)
	samples [4]SystemMetrics
	sampleN int
}

var defaultCollector = &metricsCollector{}
```

- [ ] Step 4: Replace the existing `GetSystemMetrics()` with a delegation to `defaultCollector.collect()`:

```go
func GetSystemMetrics() (SystemMetrics, error) {
	return defaultCollector.collect()
}
```

- [ ] Step 5: Add the `fallback()` method:

```go
func (c *metricsCollector) fallback() SystemMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastValid
}
```

- [ ] Step 6: Wrap the existing computation logic in `collect()` — acquire `c.mu` at start; check `ret != 0` NTSTATUS and return `c.lastValid` on failure; store result in `c.lastValid` on success:

```go
func (c *metricsCollector) collect() (SystemMetrics, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	ret, _, _ := ntQuerySystemInformation.Call(/* existing args */)
	if ret != 0 {
		log.Printf("[metrics] NtQuerySystemInformation NTSTATUS=0x%X — returning last valid", ret)
		return c.lastValid, nil
	}
	// ... existing computation of SystemMetrics ...
	m := SystemMetrics{ /* computed values */ }
	c.lastValid = m
	return m, nil
}
```

Move the existing computation body verbatim into `collect()` — do not alter the math, only restructure into the method and add the NTSTATUS guard.

- [ ] Step 7: Ensure `sync` and `log` are imported in `metrics_windows.go`.

- [ ] Step 8: Run `go test -run TestMetricsSyscallFailure ./internal/capture/...` — expect PASS.

- [ ] Step 9: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/capture/metrics_windows.go apps/agent/internal/capture/metrics_windows_test.go
git -C "D:/Time champ-agent" commit -m "fix(capture): thread-safe metricsCollector + NTSTATUS error check"
```

---

### Task 5: Metrics 4-sample amortization

**Files:**
- Modify: `apps/agent/internal/capture/metrics_windows.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Add `AddSample` and `Average` methods to `metricsCollector` in `metrics_windows.go`:

```go
// AddSample stores a new metric reading into the ring buffer.
func (c *metricsCollector) AddSample(m SystemMetrics) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.samples[c.sampleN%4] = m
	c.sampleN++
}

// Average computes the mean of all buffered samples (up to 4), resets the
// buffer, and returns the averaged result. Call once per reporting interval.
func (c *metricsCollector) Average() SystemMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := c.sampleN
	if n == 0 {
		return c.lastValid
	}
	if n > 4 {
		n = 4
	}
	var cpuSum float64
	var memSum uint64
	for i := range n {
		cpuSum += c.samples[i].CPUPercent
		memSum += c.samples[i].MemUsedMB
	}
	avg := SystemMetrics{
		CPUPercent:      cpuSum / float64(n),
		MemUsedMB:       memSum / uint64(n),
		MemTotalMB:      c.samples[0].MemTotalMB,
		AgentCPUPercent: c.samples[n-1].AgentCPUPercent,
		AgentMemMB:      c.samples[n-1].AgentMemMB,
	}
	c.sampleN = 0 // reset for next minute
	c.lastValid = avg
	return avg
}
```

- [ ] Step 2: In `cmd/agent/main.go`, change the `metricsTicker` interval from 60s to 15s:

```go
metricsTicker := time.NewTicker(15 * time.Second)
```

- [ ] Step 3: In the `metricsTicker.C` case, call `defaultCollector.AddSample(m)` instead of inserting to the buffer:

```go
case <-metricsTicker.C:
	withRecover("metrics-sample", crashReporter, func() {
		m, err := capture.GetSystemMetrics()
		if err != nil {
			log.Printf("[agent] metrics error: %v", err)
			return
		}
		capture.DefaultCollector().AddSample(m)
	})
```

- [ ] Step 4: Expose `DefaultCollector()` in `metrics_windows.go`:

```go
// DefaultCollector returns the package-level metricsCollector for use by main.
func DefaultCollector() *metricsCollector { return defaultCollector }
```

- [ ] Step 5: Add a separate `metricsFlushTicker` at 60s that calls `Average()` and inserts to the buffer:

```go
metricsFlushTicker := time.NewTicker(60 * time.Second)
defer metricsFlushTicker.Stop()

// In main select:
case <-metricsFlushTicker.C:
	withRecover("metrics-flush", crashReporter, func() {
		avg := capture.DefaultCollector().Average()
		if err := buf.InsertMetrics(avg); err != nil {
			log.Printf("[agent] metrics insert error: %v", err)
		}
	})
```

- [ ] Step 6: Run `go build ./cmd/agent/...` — expect no output.

- [ ] Step 7: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/capture/metrics_windows.go apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(capture): 4-sample metrics amortization — 15s collection, 60s average"
```

---

### Task 6: Replace wmic + 800ms GetActiveWindow cap (Windows)

**Files:**
- Modify: `apps/agent/internal/capture/activity_windows.go`

- [ ] Step 1: Read `internal/capture/activity_windows.go` to find the existing `wmicProcessName()` function (or equivalent wmic invocation) and the `GetActiveWindow()` function body.

- [ ] Step 2: Rename the existing body of `GetActiveWindow()` to `getActiveWindowImpl()`:

```go
func getActiveWindowImpl() (ActiveWindow, error) {
	// ... move existing body here verbatim ...
}
```

- [ ] Step 3: Replace `wmicProcessName(pid)` everywhere in the file with `toolhelpProcessName(pid)`.

- [ ] Step 4: Add the `toolhelpProcessName` function:

```go
// toolhelpProcessName uses CreateToolhelp32Snapshot to find a process name by
// PID. Pure Win32 — no subprocess, no WMI dependency, returns in <1ms.
func toolhelpProcessName(pid uint32) string {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return ""
	}
	for {
		if entry.ProcessID == pid {
			return windows.UTF16ToString(entry.ExeFile[:])
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
		}
	}
	return ""
}
```

- [ ] Step 5: Add the last-known window store at package level:

```go
var lastKnownWindow atomic.Pointer[ActiveWindow]
```

- [ ] Step 6: Write the new `GetActiveWindow()` with 800ms timeout:

```go
func GetActiveWindow() (ActiveWindow, error) {
	type result struct {
		w   ActiveWindow
		err error
	}
	ch := make(chan result, 1) // buffered: goroutine never leaks
	go func() {
		w, err := getActiveWindowImpl()
		ch <- result{w, err}
	}()
	select {
	case r := <-ch:
		if r.err == nil {
			lastKnownWindow.Store(&r.w)
		}
		return r.w, r.err
	case <-time.After(800 * time.Millisecond):
		if p := lastKnownWindow.Load(); p != nil {
			return *p, nil // return last known — duration keeps accumulating
		}
		return ActiveWindow{}, fmt.Errorf("GetActiveWindow timeout")
	}
}
```

- [ ] Step 7: Ensure imports include `sync/atomic`, `fmt`, `time`, `unsafe`, `golang.org/x/sys/windows`.

- [ ] Step 8: Delete the old `wmicProcessName()` function entirely.

- [ ] Step 9: Run `go build ./internal/capture/...` — expect no output.

- [ ] Step 10: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/capture/activity_windows.go
git -C "D:/Time champ-agent" commit -m "fix(capture): replace wmic with CreateToolhelp32Snapshot + 800ms cap"
```

---

### Task 7: Event-driven window tracking (Windows SetWinEventHook)

**Files:**
- Modify: `apps/agent/internal/capture/activity_windows.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Add the WinEventHook constants, proc references, and package-level state at the top of `activity_windows.go` (after existing var block):

```go
const (
	EVENT_SYSTEM_FOREGROUND = 0x0003
	WINEVENT_OUTOFCONTEXT   = 0x0000
)

var (
	procSetWinEventHook = user32.NewProc("SetWinEventHook")
	procUnhookWinEvent  = user32.NewProc("UnhookWinEvent")
	procGetMessage      = user32.NewProc("GetMessageW")

	// globalWindowCh is set before installing the hook and read in the callback.
	globalWindowCh atomic.Pointer[chan<- ActiveWindow]

	// winEventProcCallback is the syscall-compatible callback pointer.
	winEventProcCallback = syscall.NewCallback(winEventProc)
)
```

If `user32` is not yet declared, add:
```go
var user32 = windows.NewLazySystemDLL("user32.dll")
```

- [ ] Step 2: Add the WinEvent callback function:

```go
func winEventProc(hook, event, hwnd, idObj, idChild uintptr, thread, ts uint32) uintptr {
	if event != EVENT_SYSTEM_FOREGROUND {
		return 0
	}
	ch := globalWindowCh.Load()
	if ch == nil {
		return 0
	}
	win, err := getActiveWindowImpl() // re-poll from foreground HWND
	if err != nil {
		return 0
	}
	select {
	case *ch <- win:
	default: // drop if consumer is slow
	}
	return 0
}
```

- [ ] Step 3: Add `StartWindowEventStream`:

```go
// StartWindowEventStream installs a WinEventHook and returns a channel that
// receives an ActiveWindow each time the foreground window changes.
// Falls back to nil,err if the hook cannot be installed — caller should
// fall back to polling in that case.
func StartWindowEventStream(ctx context.Context) (<-chan ActiveWindow, error) {
	ch := make(chan ActiveWindow, 64)
	var sendCh chan<- ActiveWindow = ch
	globalWindowCh.Store(&sendCh)

	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer globalWindowCh.Store(nil)

		hook, _, err := procSetWinEventHook.Call(
			EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
			0,
			winEventProcCallback,
			0, 0,
			WINEVENT_OUTOFCONTEXT,
		)
		if hook == 0 {
			ready <- fmt.Errorf("SetWinEventHook: %w", err)
			return
		}
		defer procUnhookWinEvent.Call(hook)
		ready <- nil

		type MSG struct {
			HWND    uintptr
			Message uint32
			WParam  uintptr
			LParam  uintptr
			Time    uint32
			Pt      [2]int32
		}
		var msg MSG
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			r, _, _ := procGetMessage.Call(
				uintptr(unsafe.Pointer(&msg)), 0, 0, 0,
			)
			if r == 0 || r == ^uintptr(0) { // WM_QUIT or error
				return
			}
		}
	}()

	if err := <-ready; err != nil {
		return nil, err
	}
	return ch, nil
}
```

- [ ] Step 4: Ensure imports include `context`, `runtime`, `syscall`.

- [ ] Step 5: In `cmd/agent/main.go`, replace the `windowTicker` setup with event-driven + fallback:

```go
windowEvents, hookErr := capture.StartWindowEventStream(ctx)
if hookErr != nil {
	log.Printf("[agent] window hook failed (%v) — falling back to 1s poll", hookErr)
	windowEvents = nil
}

var windowFallbackTicker *time.Ticker
if windowEvents == nil {
	windowFallbackTicker = time.NewTicker(time.Second)
	defer windowFallbackTicker.Stop()
}
```

- [ ] Step 6: In the main select, replace the old `windowTicker.C` case with two cases:

```go
case win, ok := <-windowEvents:
	if !ok {
		windowEvents = nil
		continue
	}
	withRecover("window-event", crashReporter, func() {
		processWindowEvent(win /* existing args */)
	})
case <-func() <-chan time.Time {
	if windowFallbackTicker != nil {
		return windowFallbackTicker.C
	}
	return nil
}():
	withRecover("window-poll", crashReporter, func() {
		win, err := capture.GetActiveWindow()
		if err == nil {
			processWindowEvent(win /* existing args */)
		}
	})
```

Where `processWindowEvent` is a helper extracted from the existing window-tick body (extract if not already done).

- [ ] Step 7: Keep `idleTicker := time.NewTicker(time.Second)` as a separate ticker (idle is time-based, not event-based).

- [ ] Step 8: Run `go build ./...` — expect no output.

- [ ] Step 9: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/capture/activity_windows.go apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(capture): event-driven window tracking via SetWinEventHook with poll fallback"
```

---

### Task 8: Idle accuracy — 24h spike filter + atomic lastKnownIdleSec

**Files:**
- Modify: `apps/agent/internal/capture/idle_windows.go`
- Create: `apps/agent/internal/capture/idle_windows_test.go`

- [ ] Step 1: Read `internal/capture/idle_windows.go` to find the `IdleSeconds()` function and the `diffMs` computation.

- [ ] Step 2: Create `internal/capture/idle_windows_test.go`:

```go
//go:build windows

package capture

import "testing"

func TestIdleWraparound24hCap(t *testing.T) {
	// Reset state
	lastKnownIdleSec.Store(60)

	// Simulate wraparound: diffMs > 24h
	result := applyIdleCap(25 * 60 * 60 * 1000) // 25 hours in ms
	if result != 60 {
		t.Errorf("expected lastKnown=60, got %d", result)
	}

	// Normal value passes through
	result = applyIdleCap(5000) // 5 seconds
	if result != 5 {
		t.Errorf("expected 5, got %d", result)
	}
}
```

- [ ] Step 3: Add `lastKnownIdleSec` atomic and constants to `idle_windows.go`:

```go
import "sync/atomic"

var lastKnownIdleSec atomic.Uint32

const maxReasonableIdleMs uint64 = 24 * 60 * 60 * 1000 // 24 hours
```

- [ ] Step 4: Add `applyIdleCap` function:

```go
// applyIdleCap returns the idle seconds, capping wraparound artifacts.
func applyIdleCap(diffMs uint64) uint32 {
	if diffMs > maxReasonableIdleMs {
		return lastKnownIdleSec.Load()
	}
	secs := uint32(diffMs / 1000)
	lastKnownIdleSec.Store(secs)
	return secs
}
```

- [ ] Step 5: In `IdleSeconds()`, replace the final return statement (where `diffMs` is converted to seconds) with:

```go
return applyIdleCap(diffMs), nil
```

- [ ] Step 6: Update the return type of `IdleSeconds()` if it currently returns `(int, error)` — change to `(uint32, error)` so the caller receives an unsigned value. Update all call sites in `cmd/agent/main.go` accordingly.

- [ ] Step 7: Run `go test -run TestIdleWraparound ./internal/capture/...` — expect PASS.

- [ ] Step 8: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/capture/idle_windows.go apps/agent/internal/capture/idle_windows_test.go
git -C "D:/Time champ-agent" commit -m "fix(capture): 24h idle spike filter for uint32 wraparound edge case"
```

---

### Task 9: 3-sample rolling median + 2s AFK hysteresis

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`
- Create: `apps/agent/cmd/agent/main_test.go` (or add to existing if present)

- [ ] Step 1: Add `medianUint32` helper to `cmd/agent/main.go` (or a new file `cmd/agent/idle_filter.go` in the same package):

```go
// medianUint32 returns the median of a [3]uint32 array without allocation.
func medianUint32(a [3]uint32) uint32 {
	x, y, z := a[0], a[1], a[2]
	if x > y {
		x, y = y, x
	}
	if y > z {
		y, z = z, y
	}
	if x > y {
		x, y = y, x
	}
	_ = x
	_ = z
	return y // middle value
}
```

- [ ] Step 2: Create or modify `cmd/agent/main_test.go` with:

```go
package main

import "testing"

func TestMedianUint32(t *testing.T) {
	cases := []struct {
		in   [3]uint32
		want uint32
	}{
		{[3]uint32{1, 2, 3}, 2},
		{[3]uint32{100, 1, 2}, 2},     // spike filtered
		{[3]uint32{0, 86400, 5}, 5},   // 24h spike filtered
		{[3]uint32{10, 10, 10}, 10},
	}
	for _, c := range cases {
		got := medianUint32(c.in)
		if got != c.want {
			t.Errorf("medianUint32(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}
```

- [ ] Step 3: In the main event loop, declare the rolling state before the select:

```go
var (
	idleSamples        [3]uint32
	idleSampleIdx      int
	activeConfirmCount int
)
```

- [ ] Step 4: In the `idleTicker.C` case (1s), replace the existing idle reading with:

```go
rawIdle, _ := capture.IdleSeconds()
idleSamples[idleSampleIdx%3] = rawIdle
idleSampleIdx++
idleSec := medianUint32(idleSamples)

// Hysteresis: require 2 consecutive below-threshold readings to leave AFK
if idleSec < uint32(cfg.IdleThreshold) {
	activeConfirmCount++
} else {
	activeConfirmCount = 0
}
prevAFK := isAFK
if isAFK && activeConfirmCount >= 2 {
	isAFK = false
} else if !isAFK && idleSec >= uint32(cfg.IdleThreshold) {
	isAFK = true
}
if prevAFK != isAFK {
	log.Printf("[agent] AFK state changed: %v → %v (idle=%ds)", prevAFK, isAFK, idleSec)
}
```

- [ ] Step 5: Run `go test -run TestMedianUint32 ./cmd/agent/...` — expect PASS.

- [ ] Step 6: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go apps/agent/cmd/agent/main_test.go
git -C "D:/Time champ-agent" commit -m "fix(agent): 3-sample rolling median + 2s hysteresis for AFK accuracy"
```

---

### Task 10: Heartbeat queue 1-hour cap

**Files:**
- Modify: `apps/agent/internal/heartbeat/merge.go`
- Modify: `apps/agent/internal/heartbeat/merge_test.go`

- [ ] Step 1: Read `internal/heartbeat/merge.go` to find the `Push` function and the `commitInterval` check.

- [ ] Step 2: Add the constant and the cap guard in `merge.go`. After the existing `if merged.Duration >= q.commitInterval` block, add:

```go
const maxEventDuration = time.Hour

// Also commit if a single cached event has been accumulating for > 1 hour.
// Prevents memory growth and produces clean hourly chunks for long sessions.
if merged != nil && merged.Duration >= maxEventDuration {
	q.onCommit(*merged)
	e := event
	q.lastHeartbeat[stream] = &e
	return
}
```

- [ ] Step 3: Ensure `time` is imported in `merge.go`.

- [ ] Step 4: Add the following test to `internal/heartbeat/merge_test.go` (read the file first to find the correct test function signature pattern):

```go
func TestHeartbeatQueueHourCap(t *testing.T) {
	commits := 0
	q := NewQueue(60*time.Second, func(e Event) { commits++ })

	base := time.Now()
	// Push same event for 2 simulated hours (7200 1-second events)
	for i := range 7200 {
		q.Push("window", Event{
			Data:      map[string]string{"app": "Chrome"},
			Timestamp: base.Add(time.Duration(i) * time.Second),
			Duration:  time.Second,
		}, 2*time.Second)
	}
	q.FlushAll()

	if commits < 2 {
		t.Errorf("expected ≥2 commits for 2 hours, got %d", commits)
	}
}
```

- [ ] Step 5: Run `go test -run TestHeartbeatQueueHourCap ./internal/heartbeat/...` — expect PASS.

- [ ] Step 6: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/heartbeat/merge.go apps/agent/internal/heartbeat/merge_test.go
git -C "D:/Time champ-agent" commit -m "fix(heartbeat): cap event duration at 1 hour to prevent unbounded accumulation"
```

---

### Task 11: Data pipeline — screenshot orphan guard + 422 permanent error

**Files:**
- Modify: `apps/agent/internal/sync/uploader.go`
- Modify: `apps/agent/internal/sync/uploader_test.go`

- [ ] Step 1: Read `internal/sync/uploader.go` to find `FlushScreenshots()` and the per-record retry loop.

- [ ] Step 2: At the top of the per-record loop in `FlushScreenshots()`, before the `WithRetry` block, add the orphan guard:

```go
if _, statErr := os.Stat(r.LocalPath); os.IsNotExist(statErr) {
	log.Printf("[uploader] screenshot file missing — discarding record id=%d path=%s", r.ID, r.LocalPath)
	_ = u.db.MarkScreenshotSynced(r.ID, "discarded")
	flushed++
	continue
}
```

- [ ] Step 3: Read `internal/sync/client.go` to find `isPermanentHTTPStatus` (or the equivalent). Add 422:

```go
func isPermanentHTTPStatus(code int) bool {
	switch code {
	case http.StatusBadRequest,        // 400
		http.StatusUnauthorized,        // 401
		http.StatusForbidden,           // 403
		http.StatusNotFound,            // 404
		http.StatusConflict,            // 409
		http.StatusUnprocessableEntity: // 422 — bad data, never retry
		return true
	}
	return false
}
```

If the function already exists, add `http.StatusUnprocessableEntity` to the switch.

- [ ] Step 4: Ensure `os` is imported in `uploader.go`.

- [ ] Step 5: Add the following test to `internal/sync/uploader_test.go` (read the file first to match existing test structure):

```go
func TestScreenshotSkipsMissingFile(t *testing.T) {
	dir := t.TempDir()
	db, _ := buffer.Open(dir)
	defer db.Close()

	// Insert a record pointing to a file that doesn't exist
	_ = db.InsertScreenshot(buffer.ScreenshotRecord{
		EmployeeID: "emp1", OrgID: "org1",
		LocalPath:  filepath.Join(dir, "nonexistent.jpg"),
		CapturedAt: time.Now(),
	})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("API should not be called for missing file")
	}))
	defer srv.Close()

	u := NewUploader(NewClient(srv.URL, "tok"), db)
	n, err := u.FlushScreenshots()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 discarded, got %d", n)
	}
}
```

Add imports `path/filepath`, `net/http/httptest` if not already present.

- [ ] Step 6: Run `go test -run TestScreenshotSkipsMissingFile ./internal/sync/...` — expect PASS.

- [ ] Step 7: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/sync/uploader.go apps/agent/internal/sync/uploader_test.go apps/agent/internal/sync/client.go
git -C "D:/Time champ-agent" commit -m "fix(uploader): discard orphaned screenshot records + treat HTTP 422 as permanent"
```

---

### Task 12: WAL drop counter + checkpoint timeout + autocheckpoint=200

**Files:**
- Modify: `apps/agent/internal/buffer/db.go`

- [ ] Step 1: Read `internal/buffer/db.go` to find the `DB` struct, `Open()`, `Checkpoint()`, and all `Insert*()` functions.

- [ ] Step 2: Add `DroppedEvents` to the `DB` struct:

```go
import "sync/atomic"

type DB struct {
	conn          *sql.DB
	DroppedEvents atomic.Uint64
}
```

- [ ] Step 3: In `Open()`, change the autocheckpoint pragma (find existing `wal_autocheckpoint` pragma or add it after WAL mode):

```go
conn.Exec(`PRAGMA wal_autocheckpoint=200`) // ~800KB trigger
```

- [ ] Step 4: Rewrite `Checkpoint()` to use a context timeout:

```go
func (db *DB) Checkpoint() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := db.conn.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
	return err
}
```

- [ ] Step 5: In each `Insert*()` function, after the `if err != nil` block, add the drop counter:

```go
if err != nil {
	if IsDiskFull(err) {
		db.DroppedEvents.Add(1)
		log.Printf("[buffer] event dropped (disk full or WAL cap): %v", err)
	}
	return err
}
```

Apply this pattern to `InsertActivity`, `InsertScreenshot`, `InsertMetrics`, and any other insert functions.

- [ ] Step 6: Find the health response builder (look in `internal/health/` or wherever the health JSON is constructed). Add:

```go
"dropped_events": buf.DroppedEvents.Load(),
```

- [ ] Step 7: Ensure `context` is imported in `db.go`.

- [ ] Step 8: Run `go build ./...` — expect no output.

- [ ] Step 9: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/buffer/db.go
git -C "D:/Time champ-agent" commit -m "fix(buffer): WAL drop counter, 10s checkpoint timeout, lower autocheckpoint threshold"
```

---

### Task 13: SQLite write batcher

**Files:**
- Create: `apps/agent/internal/buffer/batcher.go`
- Create: `apps/agent/internal/buffer/batcher_test.go`
- Modify: `apps/agent/internal/buffer/db.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `internal/buffer/db.go` to understand the `ActivityEvent` struct and the existing `InsertActivity()` signature.

- [ ] Step 2: Create `internal/buffer/batcher.go`:

```go
package buffer

import (
	"log"
	"sync"
	"time"
)

// WriteBatcher accumulates activity events and flushes them as a single
// SQLite transaction every window duration or when maxBatch is reached.
// This gives ~100x write throughput vs individual inserts.
type WriteBatcher struct {
	db       *DB
	mu       sync.Mutex
	pending  []ActivityEvent
	timer    *time.Timer
	maxBatch int
	window   time.Duration
}

// NewWriteBatcher creates a batcher. Flush happens every window or at maxBatch events.
func NewWriteBatcher(db *DB, window time.Duration, maxBatch int) *WriteBatcher {
	return &WriteBatcher{db: db, window: window, maxBatch: maxBatch}
}

// Add queues an event for batched insertion.
func (b *WriteBatcher) Add(e ActivityEvent) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = append(b.pending, e)
	if len(b.pending) >= b.maxBatch {
		b.flushLocked()
		return
	}
	if b.timer == nil {
		b.timer = time.AfterFunc(b.window, b.Flush)
	}
}

// Flush writes all pending events to SQLite immediately. Safe to call on shutdown.
func (b *WriteBatcher) Flush() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.flushLocked()
}

func (b *WriteBatcher) flushLocked() {
	if len(b.pending) == 0 {
		return
	}
	events := make([]ActivityEvent, len(b.pending))
	copy(events, b.pending)
	b.pending = b.pending[:0]
	if b.timer != nil {
		b.timer.Stop()
		b.timer = nil
	}
	if err := b.db.InsertActivityBatch(events); err != nil {
		log.Printf("[batcher] flush failed: %v", err)
		b.db.DroppedEvents.Add(uint64(len(events)))
	}
}
```

- [ ] Step 3: Add `InsertActivityBatch` to `internal/buffer/db.go`:

```go
// InsertActivityBatch inserts multiple activity events in a single transaction.
func (db *DB) InsertActivityBatch(events []ActivityEvent) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO activity_events
		(employee_id, org_id, app_name, window_title, url, category, duration_ms, started_at, ended_at)
		VALUES (?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, e := range events {
		if _, err := stmt.Exec(
			e.EmployeeID, e.OrgID, e.AppName, e.WindowTitle,
			e.URL, e.Category, e.DurationMs,
			e.StartedAt.UTC().Format(time.RFC3339),
			e.EndedAt.UTC().Format(time.RFC3339),
		); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}
```

- [ ] Step 4: Create `internal/buffer/batcher_test.go`:

```go
package buffer

import (
	"testing"
	"time"
)

func TestWriteBatcherFlushOnWindow(t *testing.T) {
	dir := t.TempDir()
	db, _ := Open(dir)
	defer db.Close()

	b := NewWriteBatcher(db, 50*time.Millisecond, 200)
	b.Add(ActivityEvent{
		EmployeeID: "e1", OrgID: "o1", AppName: "Chrome",
		StartedAt: time.Now(), EndedAt: time.Now().Add(time.Second), DurationMs: 1000,
	})

	time.Sleep(100 * time.Millisecond) // wait for timer flush

	events, _ := db.ListUnsyncedActivity(10)
	if len(events) != 1 {
		t.Errorf("expected 1 event after timer flush, got %d", len(events))
	}
}

func TestWriteBatcherFlushOnCap(t *testing.T) {
	dir := t.TempDir()
	db, _ := Open(dir)
	defer db.Close()

	b := NewWriteBatcher(db, 10*time.Second, 3) // cap of 3
	for i := range 3 {
		b.Add(ActivityEvent{
			EmployeeID: "e1", OrgID: "o1", AppName: "App",
			StartedAt: time.Now(), EndedAt: time.Now().Add(time.Second),
			DurationMs: int64(i * 1000),
		})
	}
	// At 3 events, should flush immediately without waiting for timer
	events, _ := db.ListUnsyncedActivity(10)
	if len(events) != 3 {
		t.Errorf("expected 3 events after cap flush, got %d", len(events))
	}
}
```

- [ ] Step 5: In `cmd/agent/main.go`, create the batcher at startup:

```go
batcher := buffer.NewWriteBatcher(buf, 5*time.Second, 200)
```

- [ ] Step 6: Replace `buf.InsertActivity(e)` (called from the heartbeat queue `onCommit` callback) with `batcher.Add(e)`.

- [ ] Step 7: In the shutdown/cleanup path, call `batcher.Flush()` before exit.

- [ ] Step 8: Run `go test -run TestWriteBatcher ./internal/buffer/...` — expect PASS.

- [ ] Step 9: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/buffer/batcher.go apps/agent/internal/buffer/batcher_test.go apps/agent/internal/buffer/db.go apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(buffer): SQLite write batcher — 5s window, 200-event cap, single transaction"
```

---

### Task 14: Classification LRU cache

**Files:**
- Modify: `apps/agent/internal/classifier/classifier.go`
- Create: `apps/agent/internal/classifier/classifier_test.go`
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `internal/classifier/classifier.go` to find the package-level `Classify()` function signature and the `Rule` type.

- [ ] Step 2: Add the `Cache` type to `classifier.go`:

```go
// Cache wraps the classifier with a simple LRU cache to avoid re-running
// 50+ regexes for apps the agent has already seen.
type Cache struct {
	mu      sync.Mutex
	entries map[string]string // key → category
	keys    []string          // insertion order for FIFO eviction
	maxSize int
}

// NewCache creates a classification cache with the given capacity.
func NewCache(maxSize int) *Cache {
	return &Cache{
		entries: make(map[string]string, maxSize),
		keys:    make([]string, 0, maxSize),
		maxSize: maxSize,
	}
}

// Classify returns the category, using the cache for repeated lookups.
func (c *Cache) Classify(app, title, url string, rules []Rule) string {
	key := cacheKey(app, title)
	c.mu.Lock()
	if cat, ok := c.entries[key]; ok {
		c.mu.Unlock()
		return cat
	}
	c.mu.Unlock()

	cat := Classify(app, title, url, rules) // call existing package-level func

	c.mu.Lock()
	if len(c.entries) >= c.maxSize {
		// FIFO eviction: remove oldest key
		oldest := c.keys[0]
		c.keys = c.keys[1:]
		delete(c.entries, oldest)
	}
	c.entries[key] = cat
	c.keys = append(c.keys, key)
	c.mu.Unlock()
	return cat
}

func cacheKey(app, title string) string {
	t := title
	if len(t) > 32 {
		t = t[:32]
	}
	return app + "|" + t
}
```

- [ ] Step 3: Ensure `sync` is imported in `classifier.go`.

- [ ] Step 4: Create `internal/classifier/classifier_test.go`:

```go
package classifier

import "testing"

func TestClassifierCache(t *testing.T) {
	rules := DefaultRules // use the package's default rules

	cache := NewCache(512)

	// First call — cache miss, regex runs
	cat1 := cache.Classify("chrome", "GitHub", "", rules)
	if cat1 == "" {
		t.Fatal("expected non-empty category for chrome/GitHub")
	}

	// Same inputs — should hit cache and return identical result
	cat2 := cache.Classify("chrome", "GitHub", "", rules)
	if cat2 != cat1 {
		t.Errorf("cache returned different result: %s vs %s", cat1, cat2)
	}

	// Eviction: fill past maxSize
	smallCache := NewCache(2)
	smallCache.Classify("app1", "title1", "", rules)
	smallCache.Classify("app2", "title2", "", rules)
	smallCache.Classify("app3", "title3", "", rules) // evicts app1
	if _, ok := smallCache.entries["app1|title1"]; ok {
		t.Error("expected app1 to be evicted after capacity exceeded")
	}
}
```

- [ ] Step 5: In `cmd/agent/main.go`, instantiate the cache at startup:

```go
classifierCache := classifier.NewCache(512)
```

- [ ] Step 6: Replace all calls to `classifier.Classify(win.AppName, win.WindowTitle, win.URL, classifier.DefaultRules)` with:

```go
classifierCache.Classify(win.AppName, win.WindowTitle, win.URL, classifier.DefaultRules)
```

- [ ] Step 7: Run `go test -run TestClassifierCache ./internal/classifier/...` — expect PASS.

- [ ] Step 8: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/internal/classifier/classifier.go apps/agent/internal/classifier/classifier_test.go apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(classifier): 512-entry LRU cache — eliminates repeated regex evaluation"
```

---

### Task 15: Screenshot worker goroutine

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `cmd/agent/main.go` to find the existing screenshot logic inside the `screenshotTicker.C` case (JPEG encode, file write, buffer insert).

- [ ] Step 2: After the batcher initialization, add the screenshot signal channel and worker goroutine:

```go
screenshotSig := make(chan struct{}, 1)
safeGo("screenshot-worker", crashReporter, func() {
	for {
		select {
		case <-ctx.Done():
			return
		case <-screenshotSig:
			if isAFK {
				continue
			}
			path, err := capture.CaptureScreenshot(cfg.DataDir)
			if err != nil {
				if buffer.IsDiskFull(err) {
					log.Printf("[screenshot] CRITICAL: disk full — cannot store screenshot")
				} else {
					log.Printf("[screenshot] capture failed: %v", err)
				}
				continue
			}
			rec := buffer.ScreenshotRecord{
				EmployeeID: cfg.EmployeeID,
				OrgID:      cfg.OrgID,
				LocalPath:  path,
				CapturedAt: time.Now().UTC(),
			}
			if err := buf.InsertScreenshot(rec); err != nil {
				log.Printf("[screenshot] buffer insert failed: %v", err)
			}
		}
	}
})
```

- [ ] Step 3: Replace the `screenshotTicker.C` case body with a non-blocking signal send:

```go
case <-screenshotTicker.C:
	withRecover("screenshot-tick", crashReporter, func() {
		select {
		case screenshotSig <- struct{}{}:
		default:
			log.Printf("[screenshot] skipping tick: previous capture still in progress")
		}
	})
```

- [ ] Step 4: Remove the old inline screenshot capture code (JPEG encode, file write, insert) from inside the ticker case — it should now only send the signal.

- [ ] Step 5: Run `go build ./cmd/agent/...` — expect no output.

- [ ] Step 6: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(agent): screenshot worker goroutine — main loop never blocks on JPEG encode"
```

---

### Task 16: Adaptive sync backpressure

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Add the `adaptiveSyncInterval` helper in `cmd/agent/main.go` (or `cmd/agent/sync_interval.go` in the same package):

```go
// adaptiveSyncInterval returns a sync interval based on buffer depth.
// More events pending → sync more aggressively.
func adaptiveSyncInterval(depth int) time.Duration {
	switch {
	case depth < 2000:
		return 30 * time.Second
	case depth < 6000:
		return 15 * time.Second
	case depth < 8000:
		return 7 * time.Second
	default:
		return 3 * time.Second
	}
}
```

- [ ] Step 2: Add the test to `cmd/agent/main_test.go`:

```go
func TestAdaptiveSyncInterval(t *testing.T) {
	cases := []struct {
		depth int
		want  time.Duration
	}{
		{0, 30 * time.Second},
		{1999, 30 * time.Second},
		{2000, 15 * time.Second},
		{5999, 15 * time.Second},
		{6000, 7 * time.Second},
		{7999, 7 * time.Second},
		{8000, 3 * time.Second},
		{10000, 3 * time.Second},
	}
	for _, c := range cases {
		got := adaptiveSyncInterval(c.depth)
		if got != c.want {
			t.Errorf("adaptiveSyncInterval(%d) = %v, want %v", c.depth, got, c.want)
		}
	}
}
```

- [ ] Step 3: After each sync cycle in the main event loop, add:

```go
depth, _ := buf.CountActivity()
if depth > 6000 {
	log.Printf("[sync] WARNING: buffer depth=%d (>6000), increasing sync frequency", depth)
}
if depth > 9500 {
	log.Printf("[sync] CRITICAL: buffer depth=%d (>9500) — events may be dropped soon", depth)
}
nextInterval := adaptiveSyncInterval(depth)
syncTicker.Reset(nextInterval)
```

- [ ] Step 4: Ensure `buf.CountActivity()` exists in `internal/buffer/db.go`. If it does not exist, add it:

```go
// CountActivity returns the number of unsynced activity events in the buffer.
func (db *DB) CountActivity() (int, error) {
	var n int
	err := db.conn.QueryRow(`SELECT COUNT(*) FROM activity_events WHERE synced = 0`).Scan(&n)
	return n, err
}
```

- [ ] Step 5: Run `go test -run TestAdaptiveSyncInterval ./cmd/agent/...` — expect PASS.

- [ ] Step 6: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go apps/agent/internal/buffer/db.go
git -C "D:/Time champ-agent" commit -m "feat(agent): adaptive sync interval based on buffer depth — no more silent drops"
```

---

### Task 17: Browser goroutine cap + streaming self-healing

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`
- Modify: `apps/agent/internal/stream/manager.go`

- [ ] Step 1: Read `cmd/agent/main.go` to find the `listenBrowserURLs` function (or equivalent) where `ln.Accept()` is called.

- [ ] Step 2: Add the semaphore-based goroutine cap to `listenBrowserURLs`:

```go
sem := make(chan struct{}, 8)
for {
	conn, err := ln.Accept()
	if err != nil {
		return
	}
	select {
	case sem <- struct{}{}:
		go func(c net.Conn) {
			defer func() { <-sem }()
			defer c.Close()
			c.SetReadDeadline(time.Now().Add(2 * time.Second))
			// existing read/parse logic here
		}(conn)
	default:
		log.Printf("[browser-urls] at capacity (8 connections) — rejecting")
		conn.Close()
	}
}
```

- [ ] Step 3: Read `internal/stream/manager.go` to find the reconnect block where `ConnectWithRetry` is called and the `return` statement after failure.

- [ ] Step 4: Replace the `return` after reconnect failure with a `continue` and log:

```go
if err := m.client.ConnectWithRetry(ctx); err != nil {
	log.Printf("[stream] reconnect failed after retries: %v — pausing stream (will retry on next heartbeat timeout)", err)
	m.setMode(ModeIdle)
	continue // stay in loop — don't exit manager
}
go m.handleControlFrames(ctx)
```

- [ ] Step 5: Find all `_ = m.client.SendFrame(ctx, ...)` calls in `manager.go`. Replace `_ =` with proper error logging:

```go
if err := m.client.SendFrame(ctx, frame); err != nil {
	log.Printf("[stream] send frame error (type=%d): %v", frame.Type, err)
}
```

Adjust `frame.Type` to match the actual field name in the `Frame` struct.

- [ ] Step 6: Ensure `net` is imported in `main.go` for `net.Conn`.

- [ ] Step 7: Run `go build ./...` — expect no output.

- [ ] Step 8: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go apps/agent/internal/stream/manager.go
git -C "D:/Time champ-agent" commit -m "fix(agent/stream): browser goroutine cap + self-healing streaming reconnect"
```

---

### Task 18: Context-propagated graceful shutdown

**Files:**
- Modify: `apps/agent/cmd/agent/main.go`

- [ ] Step 1: Read `cmd/agent/main.go` to find the existing signal handling (typically a `quit := make(chan os.Signal, 1); signal.Notify(quit, ...)` block).

- [ ] Step 2: At the top of `run()`, replace existing signal handling with context-based shutdown:

```go
ctx, cancel := context.WithCancel(context.Background())

// Graceful shutdown: SIGTERM triggers cancel, 8s hard deadline.
go func() {
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM)
	<-quit
	log.Printf("[agent] SIGTERM received — shutting down (8s deadline)")
	cancel()
	time.AfterFunc(8*time.Second, func() {
		log.Printf("[agent] shutdown deadline exceeded — forcing exit")
		os.Exit(0)
	})
}()
```

- [ ] Step 3: Pass `ctx` to all major subsystems that accept one:
  - `srv.Shutdown(ctx)` — health server
  - Any goroutines launched with `safeGo` should select on `ctx.Done()`

- [ ] Step 4: Add the shutdown case to the main select:

```go
case <-ctx.Done():
	log.Printf("[agent] context cancelled — flushing and exiting")
	batcher.Flush()
	hq.FlushAll()
	_ = buf.Checkpoint()
	os.Remove(pidFile)
	return
```

- [ ] Step 5: Remove any old `quit` channel handling that did not use context (usually a `case <-quit:` in the select that called `os.Exit` directly).

- [ ] Step 6: Ensure all `safeGo` goroutines have a `case <-ctx.Done(): return` in their inner loops.

- [ ] Step 7: Ensure imports include `context`, `os/signal`, `syscall`.

- [ ] Step 8: Run `go build ./cmd/agent/...` — expect no output.

- [ ] Step 9: Commit:
```bash
git -C "D:/Time champ-agent" add apps/agent/cmd/agent/main.go
git -C "D:/Time champ-agent" commit -m "feat(agent): context-propagated graceful shutdown with 8s hard deadline"
```

---

### Task 19: Final build verification — all platforms + race detector

**Files:** No changes — verification only.

- [ ] Step 1: Native Windows build:
```bash
cd "D:/Time champ-agent/apps/agent"
go build ./...
```
Expected: no output.

- [ ] Step 2: All tests with race detector:
```bash
cd "D:/Time champ-agent/apps/agent"
go test -race -count=1 ./...
```
Expected: all PASS, no FAIL lines, no race condition warnings.

- [ ] Step 3: Static analysis:
```bash
cd "D:/Time champ-agent/apps/agent"
go vet ./...
```
Expected: no output.

- [ ] Step 4: Cross-compile for darwin/amd64:
```bash
cd "D:/Time champ-agent/apps/agent"
GOOS=darwin GOARCH=amd64 go build ./...
```
Expected: no output.

- [ ] Step 5: Cross-compile for linux/amd64:
```bash
cd "D:/Time champ-agent/apps/agent"
GOOS=linux GOARCH=amd64 go build ./...
```
Expected: no output.

- [ ] Step 6: If any step fails, fix the issue in the relevant file and re-run that step before proceeding to the next.

- [ ] Step 7: Commit only if fixes were needed:
```bash
git -C "D:/Time champ-agent" commit -m "fix(agent): build verification fixes"
```

---

## Self-Review Checklist

After all 19 tasks are implemented, verify:

- [ ] `metricsCollector` struct (Task 4) is the same type used in `AddSample`/`Average` (Task 5) and `DefaultCollector()` (Task 5).
- [ ] `applyIdleCap` (Task 8) is called by `IdleSeconds()` and tested in `idle_windows_test.go`.
- [ ] `medianUint32` (Task 9) is tested in `main_test.go` and called in the idle sampling loop.
- [ ] `WriteBatcher` (Task 13) is created at startup in `main.go` and `Flush()` is called on shutdown (Task 18 shutdown path).
- [ ] `classifier.Cache` (Task 14) is the type instantiated in `main.go`; the package-level `Classify()` function is still callable by the cache's `Classify` method.
- [ ] `withRecover` (Task 2) is applied to every select case in the main event loop.
- [ ] `safeGo` (Task 2) is used for every long-running background goroutine (`screenshot-worker`, window event loop, streaming manager).
- [ ] `ctx` from Task 18 is threaded through to all goroutines launched with `safeGo` and to `StartWindowEventStream` (Task 7).
- [ ] `DroppedEvents` (Task 12) is exposed in the health endpoint.
- [ ] Circuit breaker `resetTimeout` field (Task 1) is exported or accessible in tests via the `c.resetTimeout = 50 * time.Millisecond` line in `TestCircuitBreakerHalfOpen`.
- [ ] `isPermanentHTTPStatus` (Task 11) includes HTTP 422 (`http.StatusUnprocessableEntity`).
- [ ] Task 19 cross-compilation passes — all Windows-only code is guarded by `//go:build windows`.
