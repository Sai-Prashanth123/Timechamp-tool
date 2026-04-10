# Agent Production Hardening — Design Spec

> **For agentic workers:** Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Eliminate all known crash, data-loss, race-condition, and measurement-accuracy bugs in the TimeChamp agent, and implement 8 architectural improvements that make the agent genuinely production-grade in performance and accuracy.

**Architecture:** Two layers of work. Layer 1: surgical per-file patches for the 15 confirmed bugs (minimal blast radius, independently revertable). Layer 2: 8 architectural improvements that change fundamental subsystem behaviour (event-driven window tracking, classification cache, write batching, adaptive sync, half-open circuit breaker, metrics amortization, screenshot worker, graceful shutdown). Together these produce an agent that is accurate to ±5ms on window durations, uses near-zero CPU for tracking, never silently drops data, and always exits cleanly.

**Tech Stack:** Go 1.22, Windows/macOS/Linux build tags, `internal/sync`, `internal/capture`, `internal/heartbeat`, `internal/buffer`, `internal/stream`, `internal/telemetry`, `internal/classifier`, `cmd/agent/main.go`

---

## Part 1 — Bug Fixes (15 confirmed issues)

### 1. Crash Resilience & Panic Recovery

#### 1A. Per-case panic recovery in the main event loop

**File:** `cmd/agent/main.go`

`defer crashReporter.Recover()` at the top of `run()` catches a top-level panic but terminates `run()` entirely when it fires — all tickers die. A panic in the screenshot case should not kill window polling.

**Fix:** `withRecover(name string, cr *telemetry.CrashReporter, fn func())` helper wraps each case body:

```go
func withRecover(name string, cr *telemetry.CrashReporter, fn func()) {
    defer func() {
        if v := recover(); v != nil {
            buf := make([]byte, 16384)
            n := runtime.Stack(buf, false)
            cr.ReportGoroutinePanic(name, v, buf[:n])
        }
    }()
    fn()
}
```

Every select case becomes:
```go
case <-screenshotTicker.C:
    withRecover("screenshot-tick", crashReporter, func() { ... })
```

The agent loop never terminates from a single case panic.

#### 1B. safeGo reports panics to crash API

**Files:** `cmd/agent/main.go`, `internal/telemetry/crash.go`

Add `ReportGoroutinePanic(name string, value any, stack []byte)` to `CrashReporter`. Posts to `/agent/crash` tagged `"error_type":"goroutine_panic"`, `"goroutine":name`. Update `safeGo` to call this instead of `log.Printf`.

#### 1C. Registration retry with keychain fallback

**File:** `cmd/agent/main.go`

```go
const maxRegAttempts = 5
var regErr error
for i := range maxRegAttempts {
    if i > 0 {
        wait := time.Duration(10*(1<<i)) * time.Second // 10s, 20s, 40s, 80s
        log.Printf("Registration attempt %d/%d (retry in %s)...", i+1, maxRegAttempts, wait)
        time.Sleep(wait)
    }
    agentToken, employeeID, orgID, regErr = agentsync.Register(...)
    if regErr == nil { break }
}
if regErr != nil {
    // Previously registered: load existing token and continue
    agentToken, _ = keychain.LoadToken()
    if agentToken == "" {
        log.Fatalf("Registration failed after %d attempts and no saved token", maxRegAttempts)
    }
    identity, _ := config.LoadIdentity(cfg.DataDir)
    orgID, employeeID = identity.OrgID, identity.EmployeeID
    log.Printf("Using existing keychain token (API unreachable at startup)")
}
```

---

### 2. Thread Safety

#### 2A. Thread-safe circuit breaker

**File:** `internal/sync/client.go`

Add `mu sync.Mutex` to `Client`. All reads/writes of `failures`, `circuitOpen`, `openedAt` go through `c.mu`:

```go
func (c *Client) IsAvailable() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    if !c.circuitOpen { return true }
    if time.Since(c.openedAt) > circuitResetAfter {
        c.circuitOpen = false
        c.failures = 0
        return true
    }
    return false
}
func (c *Client) recordFailure() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.failures++
    if c.failures >= circuitOpenThreshold {
        c.circuitOpen = true
        c.openedAt = time.Now()
    }
}
func (c *Client) recordSuccess() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.failures = 0
    c.circuitOpen = false
}
```

**Test:** `TestCircuitBreakerConcurrency` — 20 parallel goroutines calling `Post`, run with `-race`, zero warnings.

#### 2B. Thread-safe metrics collector

**Files:** `internal/capture/metrics_windows.go` (+ darwin/linux equivalents)

Move `cpuState` from package-level global to a `metricsCollector` struct with `sync.Mutex`:

```go
type metricsCollector struct {
    mu        sync.Mutex
    lastIdle  int64
    lastTotal int64
    lastRead  time.Time
    lastValid SystemMetrics
}
var defaultCollector = &metricsCollector{}
func GetSystemMetrics() (SystemMetrics, error) { return defaultCollector.collect() }
```

#### 2C. Browser URL goroutine cap

**File:** `cmd/agent/main.go`

```go
sem := make(chan struct{}, 8)
for {
    conn, err := ln.Accept()
    if err != nil { return }
    select {
    case sem <- struct{}{}:
        go func(c net.Conn) {
            defer func() { <-sem }()
            defer c.Close()
            // existing read logic
        }(conn)
    default:
        conn.Close() // at capacity — reject
    }
}
```

---

### 3. Windows Activity Detection

**File:** `internal/capture/activity_windows.go`

#### 3A. Replace wmic with CreateToolhelp32Snapshot

```go
func toolhelpProcessName(pid uint32) string {
    snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
    if err != nil { return "" }
    defer windows.CloseHandle(snap)
    var entry windows.ProcessEntry32
    entry.Size = uint32(unsafe.Sizeof(entry))
    if err := windows.Process32First(snap, &entry); err != nil { return "" }
    for {
        if entry.ProcessID == pid {
            return windows.UTF16ToString(entry.ExeFile[:])
        }
        if err := windows.Process32Next(snap, &entry); err != nil { break }
    }
    return ""
}
```

Pure Win32, no subprocess, returns in <1ms regardless of WMI state.

#### 3B. 800ms hard cap on GetActiveWindow()

```go
var lastKnownWindow atomic.Pointer[ActiveWindow]

func GetActiveWindow() (ActiveWindow, error) {
    ch := make(chan struct{ w ActiveWindow; err error }, 1)
    go func() {
        w, err := getActiveWindowImpl()
        ch <- struct{ w ActiveWindow; err error }{w, err}
    }()
    select {
    case r := <-ch:
        if r.err == nil {
            lastKnownWindow.Store(&r.w)
        }
        return r.w, r.err
    case <-time.After(800 * time.Millisecond):
        if p := lastKnownWindow.Load(); p != nil {
            return *p, ErrWindowTimeout
        }
        return ActiveWindow{}, ErrWindowTimeout
    }
}
```

The channel is buffered(1) so the goroutine never leaks — it completes and writes to the channel regardless of whether the select took the timeout path.

---

### 4. Data Pipeline Integrity

#### 4A. Screenshot orphan guard

**File:** `internal/sync/uploader.go`

```go
if _, statErr := os.Stat(r.LocalPath); os.IsNotExist(statErr) {
    log.Printf("[uploader] screenshot file missing, discarding id=%d path=%s", r.ID, r.LocalPath)
    _ = u.db.MarkScreenshotSynced(r.ID, "discarded")
    flushed++
    continue
}
```

**Test:** `TestScreenshotSkipsMissingFile` — insert DB record pointing to nonexistent path, verify it's discarded without retry.

#### 4B. HTTP 422 as permanent error

**File:** `internal/sync/uploader.go`

```go
func isPermanentError(statusCode int) bool {
    switch statusCode {
    case 400, 401, 403, 404, 409, 422:
        return true
    }
    return false
}
```

On permanent error: log event type + count (not content), discard IDs, continue.

#### 4C. WAL drop counter

**File:** `internal/buffer/db.go`

```go
type DB struct {
    conn          *sql.DB
    DroppedEvents atomic.Uint64
}
```

In each `Insert*()`: on disk-full or WAL-full error, `db.DroppedEvents.Add(1)`. Expose in `/health` response and telemetry payload.

#### 4D. WAL checkpoint with timeout + lower autocheckpoint

**File:** `internal/buffer/db.go`

```go
func (db *DB) Checkpoint() error {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _, err := db.conn.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
    return err
}
```

In `Open()`: `PRAGMA wal_autocheckpoint=200` (800KB trigger, down from 4MB).

---

### 5. Idle & AFK Accuracy

**File:** `internal/capture/idle_windows.go`, `cmd/agent/main.go`

#### 5A. 24-hour spike filter

```go
var lastKnownIdleSec atomic.Uint32
const maxReasonableIdleMs = 24 * 60 * 60 * 1000

// After computing diffMs:
if diffMs > maxReasonableIdleMs {
    return lastKnownIdleSec.Load(), nil // wraparound artifact
}
lastKnownIdleSec.Store(uint32(diffMs / 1000))
return uint32(diffMs / 1000), nil
```

#### 5B. 3-sample rolling median

```go
// In main.go window tick:
idleSamples[idleIdx%3] = capture.IdleSeconds()
idleIdx++
idleSec := medianUint32(idleSamples) // sorts [3]uint32, returns middle value
```

#### 5C. 2-second hysteresis on AFK→ACTIVE

```go
if idleSec < uint32(cfg.IdleThreshold) {
    activeConfirmCount++
} else {
    activeConfirmCount = 0
}
if isAFK && activeConfirmCount >= 2 { isAFK = false }
if !isAFK && idleSec >= uint32(cfg.IdleThreshold) { isAFK = true }
```

**Tests:** `TestIdleWraparound24hCap`, `TestIdleRollingMedian`.

---

### 6. Heartbeat Queue, Metrics Syscall & Streaming

#### 6A. 1-hour heartbeat event cap

**File:** `internal/heartbeat/queue.go`

```go
const maxEventDuration = time.Hour
if merged != nil && merged.Duration >= maxEventDuration {
    q.onCommit(*merged)
    e := event
    q.lastHeartbeat[stream] = &e
    return
}
```

**Test:** `TestHeartbeatQueueHourCap`.

#### 6B. NtQuerySystemInformation error handling

**File:** `internal/capture/metrics_windows.go`

```go
ret, _, _ := ntQuerySystemInformation.Call(...)
if ret != 0 {
    log.Printf("[metrics] NtQuerySystemInformation NTSTATUS=0x%X, using last valid", ret)
    return c.lastValid, nil
}
// on success:
c.lastValid = m
```

**Test:** `TestMetricsSyscallFailure`.

#### 6C. Streaming manager self-healing

**File:** `internal/stream/manager.go`

Replace `return` on reconnect failure with:
```go
if err := m.client.ConnectWithRetry(ctx); err != nil {
    log.Printf("[stream] reconnect failed: %v — pausing stream", err)
    m.setMode(ModeIdle)
    continue // next heartbeat ACK timeout (65s) retries
}
```

Log frame send errors at DEBUG level instead of `_ =` discard.

---

## Part 2 — Architectural Improvements (8 additions)

### A. Event-Driven Window Tracking

**Files:** `internal/capture/activity_windows.go`, `activity_darwin.go`, `activity_linux.go`

**Replace the 1-second poll with OS event hooks:**

- **Windows:** `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, ...)` — fires instantly on window focus change
- **macOS:** `NSWorkspace.didActivateApplicationNotification` via a Cocoa observer goroutine
- **Linux:** X11 `XSelectInput(root, PropertyChangeMask)` watching `_NET_ACTIVE_WINDOW`

Each platform implementation sends focus-change events to a `chan ActiveWindow` (buffered 64). The main loop reads from this channel instead of polling via ticker.

```go
// New API in capture package:
func StartWindowEventStream(ctx context.Context) (<-chan ActiveWindow, error)
```

The `windowTicker` in `main.go` is **removed**. The window case becomes:
```go
case win := <-windowEvents:
    withRecover("window-event", crashReporter, func() {
        // same heartbeat queue logic, now event-driven
    })
```

**Accuracy improvement:** ±5ms vs ±1s. CPU reduction: near-zero vs ~5ms/s.

**Fallback:** If the hook fails to initialize (rare, e.g., Wayland compositor without X11 compatibility), fall back to a 1-second poll ticker. Log a warning. The existing poll code becomes the fallback path, not the primary.

---

### B. Classification LRU Cache

**File:** `internal/classifier/classifier.go`

Add a thread-safe LRU cache (512 entries) in front of the regex engine:

```go
type Classifier struct {
    rules []rule
    cache *lruCache // key: appName+"|"+title[:32], value: category string
}

func (c *Classifier) Classify(appName, title, url string) string {
    key := appName + "|" + truncate(title, 32)
    if cat, ok := c.cache.Get(key); ok {
        return cat
    }
    cat := c.classifyUncached(appName, title, url)
    c.cache.Set(key, cat)
    return cat
}
```

Use a simple locked map with FIFO eviction at 512 entries — no external dependency needed. At 512 entries, the map is ~50KB. Expected hit rate: >99% in normal use (users run the same apps all day).

**CPU reduction:** 99% fewer regex evaluations per second.

---

### C. Screenshot Worker Goroutine

**File:** `cmd/agent/main.go`, `internal/capture/screenshot_*.go`

Screenshot capture + JPEG encode takes 80–200ms. Currently blocks all other select cases.

**Fix:** Dedicated worker with a non-blocking signal channel:

```go
screenshotSig := make(chan struct{}, 1)

// Worker goroutine (started at agent startup):
go func() {
    for {
        select {
        case <-ctx.Done(): return
        case <-screenshotSig:
            withRecover("screenshot-worker", crashReporter, func() {
                path, err := capture.CaptureScreenshot(cfg.DataDir)
                if err != nil {
                    log.Printf("[screenshot] capture failed: %v", err)
                    return
                }
                if err := buf.InsertScreenshot(...); err != nil {
                    log.Printf("[screenshot] buffer insert failed: %v", err)
                }
            })
        }
    }
}()

// Main ticker case (non-blocking signal):
case <-screenshotTicker.C:
    if !isAFK {
        select {
        case screenshotSig <- struct{}{}:
        default: // previous capture still in progress — skip this tick
            log.Printf("[screenshot] skipped tick: previous capture in progress")
        }
    }
```

Main loop never blocks on JPEG encoding. If the encoder is slow (e.g., on a weak CPU), ticks are skipped cleanly, not queued.

---

### D. Half-Open Circuit Breaker

**File:** `internal/sync/client.go`

Upgrade the binary open/closed circuit breaker to a proper 3-state machine:

```
CLOSED → (3 failures) → OPEN → (reset timeout) → HALF-OPEN → (1 probe success) → CLOSED
                                                              → (1 probe failure) → OPEN (2x timeout)
```

```go
type circuitState int
const (
    circuitClosed   circuitState = iota
    circuitOpen
    circuitHalfOpen
)

type Client struct {
    mu           sync.Mutex
    state        circuitState
    failures     int
    openedAt     time.Time
    resetTimeout time.Duration // starts at 5min, doubles on each half-open failure, cap 1h
    // ... existing fields
}

func (c *Client) IsAvailable() bool {
    c.mu.Lock()
    defer c.mu.Unlock()
    switch c.state {
    case circuitClosed:
        return true
    case circuitOpen:
        if time.Since(c.openedAt) >= c.resetTimeout {
            c.state = circuitHalfOpen
            return true // allow exactly one probe
        }
        return false
    case circuitHalfOpen:
        return false // probe already in flight
    }
    return false
}

func (c *Client) recordSuccess() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.failures = 0
    c.state = circuitClosed
    c.resetTimeout = 5 * time.Minute // reset backoff
}

func (c *Client) recordFailure() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.failures++
    if c.state == circuitHalfOpen {
        // probe failed — reopen with doubled timeout
        c.resetTimeout = min(c.resetTimeout*2, time.Hour)
        c.state = circuitOpen
        c.openedAt = time.Now()
        return
    }
    if c.failures >= circuitOpenThreshold {
        c.state = circuitOpen
        c.openedAt = time.Now()
        if c.resetTimeout == 0 { c.resetTimeout = 5 * time.Minute }
    }
}
```

No thundering herd when the API recovers. Exponential backoff on the circuit itself.

---

### E. SQLite Write Batching

**File:** `internal/buffer/db.go`, new `internal/buffer/batcher.go`

Instead of one INSERT per heartbeat commit, accumulate events for up to 5 seconds and flush as a single transaction:

```go
type writeBatcher struct {
    db       *DB
    mu       sync.Mutex
    pending  []activityInsert
    timer    *time.Timer
    maxBatch int           // flush immediately if >= maxBatch events (default 200)
    window   time.Duration // flush after this duration (default 5s)
}

func (b *writeBatcher) Add(e activityInsert) {
    b.mu.Lock()
    defer b.mu.Unlock()
    b.pending = append(b.pending, e)
    if len(b.pending) >= b.maxBatch {
        b.flushLocked()
        return
    }
    if b.timer == nil {
        b.timer = time.AfterFunc(b.window, b.flush)
    }
}

func (b *writeBatcher) flushLocked() {
    if len(b.pending) == 0 { return }
    events := b.pending
    b.pending = b.pending[:0]
    if b.timer != nil { b.timer.Stop(); b.timer = nil }

    tx, err := b.db.conn.Begin()
    if err != nil { /* handle */ return }
    stmt, _ := tx.Prepare(`INSERT INTO activity_events (...) VALUES (...)`)
    for _, e := range events {
        stmt.Exec(e.fields...)
    }
    stmt.Close()
    tx.Commit()
}
```

**Performance:** SQLite batch inserts are ~100x faster than individual inserts. Data loss window is bounded at 5 seconds. Shutdown path calls `batcher.Flush()` explicitly.

---

### F. Adaptive Sync Interval (Backpressure)

**File:** `cmd/agent/main.go`

Instead of a fixed 30s sync interval, adapt based on buffer depth:

```go
func adaptiveSyncInterval(bufferDepth int) time.Duration {
    switch {
    case bufferDepth < 2000:  return 30 * time.Second
    case bufferDepth < 6000:  return 15 * time.Second
    case bufferDepth < 8000:  return 7 * time.Second
    default:                  return 3 * time.Second
    }
}
```

After each sync cycle, query `buf.CountActivity()` and reset the sync ticker to `adaptiveSyncInterval(depth)`. Log a WARNING when depth > 6,000 (buffer at 60%). Log CRITICAL when depth > 9,500. The buffer cap (drop oldest) is a last resort, not the normal operating mode.

---

### G. Metrics 4-Sample Amortization

**File:** `internal/capture/metrics_*.go`, `cmd/agent/main.go`

Collect system metrics every 15 seconds (4× per minute) instead of once per minute. Average the 4 samples into the 60-second database record:

```go
// metricsCollector gains a ring buffer:
type metricsCollector struct {
    mu       sync.Mutex
    samples  [4]SystemMetrics
    sampleN  int
    lastValid SystemMetrics
    // ... existing fields
}

func (c *metricsCollector) AddSample(m SystemMetrics) {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.samples[c.sampleN%4] = m
    c.sampleN++
}

func (c *metricsCollector) Average() SystemMetrics {
    c.mu.Lock()
    defer c.mu.Unlock()
    // average across all collected samples (up to 4)
    n := min(c.sampleN, 4)
    if n == 0 { return c.lastValid }
    var sum SystemMetrics
    for i := range n {
        sum.CPUPercent += c.samples[i].CPUPercent
        sum.MemUsedMB  += c.samples[i].MemUsedMB
    }
    avg := SystemMetrics{
        CPUPercent:  sum.CPUPercent / float64(n),
        MemUsedMB:   sum.MemUsedMB / uint64(n),
        MemTotalMB:  c.samples[0].MemTotalMB,
    }
    c.lastValid = avg
    c.sampleN = 0 // reset for next minute
    return avg
}
```

The `metricsTicker` runs every 15s (calls `AddSample`). The per-minute insert tick calls `Average()` for the DB record. Single-point syscall failures average out. CPU spikes smooth out.

---

### H. Context-Propagated Graceful Shutdown

**File:** `cmd/agent/main.go`

Replace the implicit SIGTERM handler with a root context passed to every subsystem:

```go
ctx, cancel := context.WithCancel(context.Background())

// Signal handler:
go func() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM)
    <-sig
    log.Printf("SIGTERM received — shutting down (8s deadline)")
    cancel()
    time.AfterFunc(8*time.Second, func() {
        log.Printf("Shutdown deadline exceeded — forcing exit")
        os.Exit(0)
    })
}()
```

Every long-running call receives `ctx`:
- `buf.Checkpoint(ctx)` — already has context support (Section 4D)
- `client.Post(ctx, ...)` — passes ctx to http.NewRequestWithContext
- `hq.FlushAll(ctx)` — heartbeat queue flush respects ctx
- All goroutines select on `ctx.Done()`

On SIGTERM: all goroutines wind down, final flush happens, agent exits in ≤8 seconds guaranteed. The crash reporter is exempt from the 8-second limit only for the in-flight report it started before cancel.

---

## Files Changed

| File | Changes |
|------|---------|
| `cmd/agent/main.go` | withRecover, safeGo telemetry, registration retry, idle median+hysteresis, goroutine cap, screenshot worker, adaptive sync, event-driven window loop, root ctx, 8s shutdown |
| `internal/sync/client.go` | Mutex on circuit breaker, half-open state, exponential reset timeout |
| `internal/sync/uploader.go` | Screenshot orphan guard, 422 permanent error |
| `internal/capture/metrics_windows.go` | metricsCollector struct, NTSTATUS check, lastValid, 4-sample ring buffer |
| `internal/capture/metrics_darwin.go` | metricsCollector struct, equivalent |
| `internal/capture/metrics_linux.go` | metricsCollector struct, equivalent |
| `internal/capture/activity_windows.go` | Replace wmic → toolhelpProcessName, 800ms cap, SetWinEventHook |
| `internal/capture/activity_darwin.go` | NSWorkspace event stream |
| `internal/capture/activity_linux.go` | X11 PropertyNotify event stream |
| `internal/capture/idle_windows.go` | 24h spike filter, atomic lastKnownIdleSec |
| `internal/classifier/classifier.go` | LRU cache wrapper (512 entries) |
| `internal/heartbeat/queue.go` | 1-hour event duration cap |
| `internal/telemetry/crash.go` | ReportGoroutinePanic() method |
| `internal/buffer/db.go` | DroppedEvents counter, Checkpoint ctx timeout, lower autocheckpoint |
| `internal/buffer/batcher.go` | NEW — write batcher (5s window, 200-event max) |
| `internal/stream/manager.go` | Self-healing reconnect loop, log frame send errors |

---

## Tests Added

| Test | File | Proves |
|------|------|--------|
| `TestCircuitBreakerConcurrency` | `internal/sync/client_test.go` | Zero races under 20 parallel goroutines (`-race`) |
| `TestCircuitBreakerHalfOpen` | `internal/sync/client_test.go` | Half-open allows exactly 1 probe; failure doubles reset timeout |
| `TestIdleWraparound24hCap` | `internal/capture/idle_windows_test.go` | Values >24h capped, not passed through |
| `TestIdleRollingMedian` | `cmd/agent/main_test.go` | Single spike doesn't flip AFK state |
| `TestHeartbeatQueueHourCap` | `internal/heartbeat/queue_test.go` | onCommit fires at ≤1h intervals |
| `TestScreenshotSkipsMissingFile` | `internal/sync/uploader_test.go` | Missing file → discard record, no retry |
| `TestMetricsSyscallFailure` | `internal/capture/metrics_windows_test.go` | Returns lastValid on NTSTATUS error, never garbage |
| `TestWriteBatcherFlushOnWindow` | `internal/buffer/batcher_test.go` | Events batched and flushed after 5s |
| `TestWriteBatcherFlushOnCap` | `internal/buffer/batcher_test.go` | 200-event cap triggers immediate flush |
| `TestAdaptiveSyncInterval` | `cmd/agent/main_test.go` | Correct interval returned at each buffer depth band |
| `TestClassifierCache` | `internal/classifier/classifier_test.go` | Cache hit returns same category, no regex re-run |
| `TestGracefulShutdown8s` | `cmd/agent/main_test.go` | Agent exits within 8s of cancel() regardless of subsystem state |

---

## Verification

1. `go build ./...` — clean on all platforms
2. `go test -race ./...` — zero race detector warnings
3. `go vet ./...` — clean
4. `GOOS=darwin go build ./...` and `GOOS=linux go build ./...` — clean
5. Manual: start agent with API down → retry logs → keychain fallback
6. Manual: run agent 10 minutes, check `/health` → `dropped_events: 0`
7. Manual (Windows): kill WMI service → agent continues with toolhelp fallback → no stalled ticks
