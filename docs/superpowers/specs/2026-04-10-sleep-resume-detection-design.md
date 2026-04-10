# Sleep / Resume Detection & Auto-Restart Design

**Date:** 2026-04-10  
**Status:** Approved  
**Scope:** `apps/agent` — Go agent + tray (Windows), launchd (macOS), systemd (Linux)

---

## Problem

When the host machine sleeps or hibernates, the agent either:

1. **Survives sleep** (process suspended by OS) — tickers are temporally displaced, idle time reports the entire sleep duration as AFK, no heartbeat is sent on wake, monitoring board shows user as offline.
2. **Is killed during sleep** (hibernate / power-off) — on resume the tray (Windows) or OS service manager (macOS/Linux) must restart it. Currently the tray uses exponential backoff (up to 5 min), so restart can be severely delayed.

Neither case is handled today. This spec covers both.

---

## Goals

- Agent resumes tracking within **≤10 seconds** of system wake on all platforms.
- Idle time is **zero** immediately after wake — sleep duration is not counted as user idle.
- Monitoring board shows the employee as **online** within one heartbeat interval after wake.
- Buffered activity/screenshots/metrics are **flushed immediately** on resume rather than waiting for the next 30 s sync tick.
- Works whether the agent runs as a **plain process** (tray-launched on Windows) or an **OS-managed service** (launchd on macOS, systemd on Linux, Windows Service opt-in).

---

## Non-Goals

- Connected-standby / modern-standby detection (Windows always-on tablets) — these are treated as normal sleep.
- Adjusting screenshot interval based on sleep duration.
- Persisting sleep/wake events to the API — telemetry only, not a core data type.

---

## Architecture

### New Package: `internal/sleepwatch`

Single file `watcher.go` with **no build tags** — identical implementation on all platforms.

```
sleepwatch.Watcher
  ├── New() *Watcher
  ├── Start()                        — starts timer-drift goroutine
  ├── Stop()                         — graceful shutdown
  ├── Signal(eventType string)       — inject external event (Windows Service power callback)
  └── C <-chan Event                 (buffered, cap 4)

sleepwatch.Event
  ├── Type     string       "suspend" | "resume"
  ├── At       time.Time
  └── Duration time.Duration  (sleep gap, on resume events only)
```

`Signal()` allows the Windows Service SCM power event callback to inject a `"resume"` or `"suspend"` event directly into the watcher's channel. The debounce timer inside the watcher deduplicates this with any concurrent timer-drift event — only one event reaches `C` regardless of how many sources fire.

**Detection algorithm — wall-clock drift:**

```go
prev := time.Now().Round(0)   // .Round(0) strips monotonic reading → wall clock only

for {
    time.Sleep(pollInterval)  // pollInterval = 5s

    now := time.Now().Round(0)
    elapsed := now.Sub(prev)  // pure wall-clock subtraction — always advances through sleep
    prev = now

    gap := elapsed - pollInterval
    if gap > wakeThreshold {  // wakeThreshold = 10s (2× pollInterval)
        w.emit(Event{Type: "resume", At: now, Duration: gap})
    }
}
```

**Why `.Round(0)` is required:**  
Go's `time.Since()` and `time.Sub()` use the monotonic clock stored in `time.Time`. On Linux and macOS, `CLOCK_MONOTONIC` / `mach_absolute_time()` **pause during sleep** — so monotonic subtraction would never detect the gap. Calling `.Round(0)` strips the monotonic reading, forcing the subtraction to use wall-clock time (`CLOCK_REALTIME` / `GetSystemTimeAsFileTime`), which always advances through sleep. This is the only cross-platform approach that requires no OS-specific code.

**Debounce:**  
Windows connected standby fires multiple resume notifications in rapid succession. A 3 s debounce timer collapses consecutive events into one before emitting to `C`. This prevents duplicate sync storms.

**Suspend detection:**  
A `suspend` event is emitted when the gap detector fires on the NEXT poll AFTER wake (it cannot fire before sleep — the process is frozen). This means there is no true pre-sleep notification from the timer-drift approach alone. Windows Service power events (see below) provide a genuine pre-sleep callback.

---

### `cmd/agent/main.go` — Main Loop Integration

`sleepwatch.Watcher` is started immediately after agent init. Its channel is added to the main `select`:

```go
case event := <-sleepWatcher.C:
    switch event.Type {

    case "suspend":
        log.Printf("[sleep] system going to sleep — flushing buffers")
        hq.FlushAll()
        _ = db.Checkpoint()

    case "resume":
        log.Printf("[sleep] system resumed after %v", event.Duration.Round(time.Second))
        // 1. Reset AFK state — do not count sleep as idle
        isAFK = false
        hq.FlushAll()
        // 2. Zero idle baseline so GetLastInputInfo sleep gap is ignored
        capture.ResetIdleBaseline()
        // 3. Force sync + heartbeat in background (non-blocking)
        go func() {
            client.ResetCircuit()           // clear any pre-sleep open circuit breaker
            _ = client.Heartbeat()          // mark online immediately
            _, _ = uploader.FlushActivity()
            _, _ = uploader.FlushScreenshots()
            _, _ = uploader.FlushMetrics()
        }()
        // 4. Reset sync ticker so next scheduled sync fires in ~5s not up to 30s
        syncTicker.Reset(5 * time.Second)
    }
```

---

### `internal/capture/idle.go` — Idle Baseline

New exported API:

```go
var idleBaselineOffset int64  // atomic int64, seconds

// ResetIdleBaseline records the current raw idle at wake time.
// All future IdleSeconds() calls subtract this offset so that
// sleep duration is never counted as user idle time.
func ResetIdleBaseline() {
    raw, err := idleSeconds()
    if err != nil { return }
    atomic.StoreInt64(&idleBaselineOffset, int64(raw))
}

// IdleSeconds returns corrected idle seconds, accounting for any sleep gap.
func IdleSeconds() (int, error) {
    raw, err := idleSeconds()
    if err != nil { return 0, err }
    offset := atomic.LoadInt64(&idleBaselineOffset)
    if offset == 0 {
        return int(raw), nil
    }
    result := int64(raw) - offset
    if result <= 0 {
        // User has been active since wake — raw idle reset below baseline.
        // Clear the baseline so future readings are unaffected.
        atomic.StoreInt64(&idleBaselineOffset, 0)
        return 0, nil
    }
    return int(result), nil
}
```

**Self-clearing logic:**  
Once the user interacts post-wake, the OS resets `GetLastInputInfo.dwTime` (Windows) / equivalent (macOS, Linux). Raw idle drops to near zero — below the offset. The offset is cleared automatically. Subsequent idle readings are unaffected.

---

### `internal/sync/client.go` — Circuit Breaker Reset

New exported method:

```go
// ResetCircuit clears an open circuit breaker so syncs can resume immediately
// after a system resume event (pre-sleep failures are no longer relevant).
func (c *Client) ResetCircuit() {
    c.failures = 0
    c.circuitOpen = false
}
```

---

### `cmd/tray/app.go` — Windows Tray (resume → immediate relaunch)

The tray also runs a `sleepwatch.Watcher`. On resume:

```go
case event := <-sleepWatcher.C:
    if event.Type == "resume" {
        log.Printf("[tray] system resumed after %v — checking agent", event.Duration.Round(time.Second))
        backoff = minBackoff   // reset monitorAgent backoff immediately
        go a.restartAgentIfNeeded()
    }
```

`restartAgentIfNeeded()`:
1. Check health endpoint (3 s timeout).
2. If healthy → nothing to do.
3. If not healthy → read PID file → send SIGTERM → wait 3 s → SIGKILL if alive.
4. Call `autoLaunchIfRegistered()`.

This replaces the worst-case 5-minute `monitorAgent` backoff with a ≤10 s recovery.

---

### OS Service Integration (Approach C)

#### Windows — `internal/service/service_windows.go`

Add `svc.AcceptPowerEvent` to accepted control codes. When SCM sends `PBT_APMRESUMEAUTOMATIC`, signal the agent's sleepwatch directly (zero-latency, fires before the 5 s timer-drift tick):

```go
const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPowerEvent

case svc.PowerEvent:
    if c.EventType == windows.PBT_APMRESUMEAUTOMATIC {
        // Signal resume to main loop via a shared channel
        select {
        case powerEventCh <- "resume":
        default:
        }
    } else if c.EventType == windows.PBT_APMSUSPEND {
        select {
        case powerEventCh <- "suspend":
        default:
        }
    }
```

The Windows Service path and the timer-drift path both write to the same `sleepwatch.C` channel — the debounce collapses them into one event.

#### macOS — `internal/service/service_darwin.go` Install()

Write `~/Library/LaunchAgents/com.timechamp.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>com.timechamp.agent</string>
  <key>ProgramArguments</key>  <array><string>/usr/local/bin/timechamp-agent</string></array>
  <key>KeepAlive</key>         <true/>
  <key>RunAtLoad</key>         <true/>
  <key>ThrottleInterval</key>  <integer>10</integer>
  <key>StandardErrorPath</key> <string>/tmp/timechamp-agent.log</string>
</dict>
</plist>
```

`KeepAlive=true` — launchd automatically restarts the agent after wake with no additional code. `ThrottleInterval=10` prevents restart storms. The timer-drift watcher in the agent handles the "survived sleep" in-process state reset.

Load immediately after writing:
```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.timechamp.agent.plist
```

#### Linux — `internal/service/service_linux.go` Install()

Write `~/.config/systemd/user/timechamp-agent.service` (user service, no root required):

```ini
[Unit]
Description=Time Champ Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%h/.local/bin/timechamp-agent
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
Environment=HOME=%h

[Install]
WantedBy=default.target
```

`Restart=always` + `RestartSec=5` handles post-resume restart automatically.  
`StartLimitBurst=10` within 60 s prevents runaway restart loops on repeated crashes.

**Note:** `After=suspend.target` is deliberately omitted. systemd's `Restart=always` is sufficient — adding `After=suspend.target` creates ordering complexity that can delay startup.

Enable and start:
```
systemctl --user daemon-reload
systemctl --user enable --now timechamp-agent
systemctl --user enable timechamp-agent.service  # survive user logout
loginctl enable-linger $(whoami)                 # survive user logout
```

---

## File Changelist

| File | Change |
|------|--------|
| `internal/sleepwatch/watcher.go` | **New** — cross-platform timer-drift watcher |
| `internal/capture/idle.go` | Add `ResetIdleBaseline()`, update `IdleSeconds()` with offset+auto-clear |
| `internal/sync/client.go` | Add `ResetCircuit()` |
| `cmd/agent/main.go` | Add `sleepWatcher.Start()`, add `case event := <-sleepWatcher.C` to select |
| `cmd/tray/app.go` | Add `sleepWatcher`, add `restartAgentIfNeeded()`, reset backoff on resume |
| `internal/service/service_windows.go` | Add `svc.AcceptPowerEvent` handling |
| `internal/service/service_darwin.go` | Add `Install()` writing launchd plist |
| `internal/service/service_linux.go` | Add `Install()` writing systemd user unit |

---

## Sequence Diagram — Windows (Tray + Timer-Drift)

```
User closes laptop
  │
  ├── [tray sleepwatch] wall-clock drift detected on next 5s tick after wake
  │     └── debounce 3s → restartAgentIfNeeded()
  │           ├── health check → not responding
  │           ├── SIGTERM agent (PID file) → wait 3s → SIGKILL
  │           └── autoLaunchIfRegistered() → new agent process
  │
  └── [agent sleepwatch] (if agent survived sleep)
        └── wall-clock drift detected
              ├── ResetIdleBaseline()
              ├── client.ResetCircuit()
              ├── client.Heartbeat()
              └── uploader.Flush*() [goroutine]
```

## Sequence Diagram — macOS / Linux (OS Service)

```
User closes laptop
  │
  OS kills agent process
  │
User opens laptop
  │
  ├── launchd / systemd restarts agent (KeepAlive / Restart=always)
  │     └── agent starts fresh — no stale state
  │
  └── [agent sleepwatch] timer-drift detects wake after first 5s tick
        ├── ResetIdleBaseline()
        ├── client.ResetCircuit()
        ├── client.Heartbeat()
        └── uploader.Flush*() [goroutine]
```

---

## Constants

| Name | Value | Rationale |
|------|-------|-----------|
| `pollInterval` | 5 s | Low enough for ≤10 s detection; negligible CPU |
| `wakeThreshold` | 10 s | 2× pollInterval; tolerates heavy CPU load without false positives |
| `debounce` | 3 s | Collapses Windows connected-standby burst events |
| `restartGracePeriod` | 3 s | Time between SIGTERM and SIGKILL in tray |
| `syncTicker reset` | 5 s | Post-resume sync fires within 5 s instead of up to 30 s |

---

## Testing

- `internal/sleepwatch/watcher_test.go` — inject mock clock; simulate 30 s wall gap with 5 s mono gap; verify event emitted with correct duration.
- `internal/capture/idle_test.go` — verify baseline subtraction, verify auto-clear when raw < offset.
- Manual: close laptop → open → verify agent log shows `[sleep] resumed after Xh` within 10 s.
