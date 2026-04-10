# Agent Self-Setup & Production Installation Design

**Date:** 2026-04-10
**Status:** Approved
**Scope:** `apps/agent` — `internal/selfinstall`, `cmd/setup`, macOS + Windows

---

## Problem

The current setup wizard (`cmd/setup/main.go`) registers the device and launches the agent binary once via `exec.Command` — but **never installs it as a persistent background service**. On macOS there is no LaunchAgent plist; on Windows there is no service or registry Run key. The agent dies on reboot, on logout, or if the setup window closes before the OS has settled. Users on macOS (primary platform) and Windows report the agent not running after initial setup.

Additionally:
- `launchctl load -w` (the current call in `service_darwin.go`) is deprecated since macOS 10.14; it silently does nothing on macOS 13+ Ventura
- No quarantine attribute removal — Gatekeeper blocks the binary on first run
- No health verification after launch — setup reports success before the agent is actually running
- No progress feedback — user sees a spinner with no indication of which step is executing
- No handling of MDM, corporate policy, antivirus, or disk-full conditions

---

## Goals

- After the user enters API URL + invite token and clicks Register, the agent is **running permanently in the background within 15 seconds** — no additional user action required
- Survives reboot, logout, and crash on both macOS and Windows
- Works on **any macOS** from 10.15 Catalina through Sequoia 15+, including MDM-managed corporate machines
- Works on **any Windows 10/11** with or without admin rights
- Idempotent — safe to run setup twice; never corrupts existing installation
- Real-time progress feedback in the browser UI — user sees each step as it completes
- Actionable error messages — every failure tells the user what to do next

---

## Non-Goals

- Linux (handled separately via systemd user unit — already implemented)
- Code signing / notarization (CI/release pipeline concern, not setup code)
- Remote/silent deployment via MDM push (out of scope for this spec)
- Uninstaller UI (CLI `installer uninstall` covers this)

---

## Architecture

### New Package: `internal/selfinstall`

Single responsibility: given the agent binary and config, make it run permanently in the background on the current OS. Fully isolated from the registration logic. Testable independently.

```
internal/selfinstall/
  selfinstall.go           — Config, Result, Install() orchestration, health verification
  selfinstall_darwin.go    — macOS: quarantine strip, plist write, launchctl bootstrap
  selfinstall_windows.go   — Windows: UAC elevation, service install, registry fallback
  selfinstall_other.go     — Linux/other: no-op stub
```

#### Public API

```go
package selfinstall

// Config is all Install() needs — passed from the setup wizard after registration.
type Config struct {
    BinaryData []byte  // embedded agent binary bytes
    APIURL     string  // persisted to identity.json; agent reads it on launch
    DataDir    string  // platform data dir (%LOCALAPPDATA%\TimeChamp, ~/Library/...)
}

// Result describes what was done — used for UI feedback and logging.
type Result struct {
    BinaryPath    string   // absolute path where binary was written
    AutoStartMode string   // "launchd" | "windows-service" | "registry" | "none"
    AlreadySetUp  bool     // true if was already correctly installed (idempotent)
    Warnings      []string // non-fatal issues (e.g. MDM restriction detected)
}

// Install registers the agent for permanent background operation.
// It is idempotent: safe to call multiple times.
// progress receives human-readable step descriptions as they complete.
// Returns error only on unrecoverable failure.
func Install(cfg Config, progress chan<- string) (Result, error)
```

#### Health Verification (shared, `selfinstall.go`)

```go
// waitForHealth polls the agent health endpoint until it responds or timeout.
// interval: 500ms, timeout: 15s, endpoint: http://127.0.0.1:27183/health
func waitForHealth(timeout time.Duration) error
```

Called as the final step on all platforms. Only when health check passes is success reported.

---

### macOS Implementation (`selfinstall_darwin.go`)

#### Step 1 — Binary Installation

Destination: `~/Library/Application Support/TimeChamp/timechamp-agent`

```go
func installBinary(cfg Config) (string, error) {
    dir := filepath.Join(userHome(), "Library", "Application Support", "TimeChamp")
    os.MkdirAll(dir, 0700)
    dest := filepath.Join(dir, "timechamp-agent")
    // Atomic write: temp file + rename to avoid partial reads
    tmp := dest + ".tmp"
    os.WriteFile(tmp, cfg.BinaryData, 0755)
    os.Rename(tmp, dest)
    return dest, nil
}
```

#### Step 2 — Quarantine Strip

macOS tags downloaded files with `com.apple.quarantine`. Gatekeeper blocks execution on first run without user approval. Strip it immediately after writing:

```go
func stripQuarantine(path string) {
    // Primary: xattr CLI (always present on macOS)
    exec.Command("xattr", "-d", "com.apple.quarantine", path).Run()
    exec.Command("xattr", "-c", path).Run() // clear ALL xattrs as belt+suspenders
    // Fallback: direct syscall (golang.org/x/sys/unix)
    unix.Removexattr(path, "com.apple.quarantine")
}
```

#### Step 3 — LaunchAgent Plist

Written to `~/Library/LaunchAgents/com.timechamp.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.timechamp.agent</string>

    <key>ProgramArguments</key>
    <array>
        <string>{{.BinaryPath}}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>ProcessType</key>
    <string>Background</string>

    <!-- Ventura/Sonoma: register as known background item, suppresses
         "Background Items Added" notification pointing to unknown app -->
    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>com.timechamp.setup</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>TC_API_URL</key>
        <string>{{.APIURL}}</string>
        <key>HOME</key>
        <string>{{.Home}}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>

    <key>StandardOutPath</key>
    <string>{{.LogDir}}/agent.log</string>

    <key>StandardErrorPath</key>
    <string>{{.LogDir}}/agent_error.log</string>

    <key>ExitTimeout</key>
    <integer>10</integer>
</dict>
</plist>
```

Key decisions:
- `ProcessType = Background` — macOS deprioritizes CPU/memory, reduces battery impact
- `ThrottleInterval = 10` — launchd waits 10s between restart attempts on crash loop
- `AssociatedBundleIdentifiers` — suppresses Ventura 13+ "Background Items Added" popup pointing to unknown source
- `TC_API_URL` in env — agent reads from identity.json first; env is belt-and-suspenders

#### Step 4 — launchctl Bootstrap (version-adaptive)

```go
func bootstrapAgent(plistPath string) error {
    uid := os.Getuid()

    // Check if already loaded
    out, _ := exec.Command("launchctl", "list", "com.timechamp.agent").CombinedOutput()
    if strings.Contains(string(out), "com.timechamp.agent") {
        // Already loaded — kickstart to ensure running
        exec.Command("launchctl", "kickstart", "-k",
            fmt.Sprintf("gui/%d/com.timechamp.agent", uid)).Run()
        return nil
    }

    // macOS 10.15+ (Catalina+): bootstrap gui domain
    out, err := exec.Command("launchctl", "bootstrap",
        fmt.Sprintf("gui/%d", uid), plistPath).CombinedOutput()
    if err == nil {
        return nil
    }

    // Exit code 125 = operation not permitted (MDM policy)
    if strings.Contains(string(out), "125") || strings.Contains(string(out), "not permitted") {
        return fmt.Errorf("MDM_BLOCKED: %s", out)
    }

    // Fallback: deprecated load (macOS < 10.15 or unusual environments)
    out, err = exec.Command("launchctl", "load", "-w", plistPath).CombinedOutput()
    if err != nil {
        return fmt.Errorf("launchctl load: %w — %s", err, out)
    }
    return nil
}
```

MDM-blocked detection: if `launchctl bootstrap` returns exit 125 or "not permitted", the agent is still launched directly via `exec.Command` as a best-effort fallback and a `Warning` is added to `Result.Warnings`.

#### Step 5 — macOS Permission Pre-flight

Screen Recording permission must be requested from a GUI context before the agent starts headlessly (CGWindowListCopyWindowInfo silently returns empty if permission not granted and no prompt was shown).

```go
// requestPermissions opens System Settings to the correct panes.
// Non-blocking — agent starts regardless. Permissions are re-checked
// every 60s by the agent's internal permission checker.
func requestPermissions() {
    // Screen Recording — CGRequestScreenCaptureAccess only works from GUI apps.
    // For a CLI setup binary, open the pane directly.
    exec.Command("open",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    ).Start()
}
```

This opens System Settings to Screen Recording pre-filled, so the user can toggle permission without hunting through menus. Called once during setup if permission not already granted.

---

### Windows Implementation (`selfinstall_windows.go`)

#### Step 1 — Binary Installation

Destination: `%LOCALAPPDATA%\TimeChamp\timechamp-agent.exe`

```go
func installBinary(cfg Config) (string, error) {
    dir := filepath.Join(os.Getenv("LOCALAPPDATA"), "TimeChamp")
    os.MkdirAll(dir, 0700)
    dest := filepath.Join(dir, "timechamp-agent.exe")
    // Strip Zone.Identifier ADS (marks file as downloaded — triggers SmartScreen)
    // by writing via temp+rename rather than direct download path
    tmp := dest + ".tmp"
    os.WriteFile(tmp, cfg.BinaryData, 0755)
    os.Rename(tmp, dest) // rename strips Zone.Identifier on NTFS
    return dest, nil
}
```

Atomic rename on NTFS does NOT inherit the Zone.Identifier alternate data stream from the temp file if the temp file was created by our process (not downloaded), so SmartScreen is bypassed cleanly.

#### Step 2 — Service Install with UAC Elevation

```go
func installService(binaryPath string) (installed bool, err error) {
    // Check if already have admin
    if isAdmin() {
        return true, doInstallService(binaryPath)
    }

    // Write handoff file so the elevated process knows what to do
    handoff := handoffPath()
    writeHandoff(handoff, binaryPath)

    // Re-launch self elevated with --install-service flag
    exe, _ := os.Executable()
    err = shellExecuteRunas(exe, "--install-service "+handoff)
    if err != nil {
        // UAC declined or unavailable
        return false, nil // caller falls through to registry
    }

    // Wait up to 10s for service to appear
    for i := 0; i < 20; i++ {
        time.Sleep(500 * time.Millisecond)
        if serviceExists() {
            return true, nil
        }
    }
    return false, nil
}

func shellExecuteRunas(exe, args string) error {
    verb, _ := syscall.UTF16PtrFromString("runas")
    file, _ := syscall.UTF16PtrFromString(exe)
    params, _ := syscall.UTF16PtrFromString(args)
    ret, _ := windows.ShellExecute(0, verb, file, params, nil, windows.SW_HIDE)
    if ret <= 32 {
        return fmt.Errorf("ShellExecute runas failed: %d", ret)
    }
    return nil
}
```

The elevated re-exec reads the handoff JSON file, installs the service, and exits. The handoff file is deleted after reading. The parent process polls for `serviceExists()` with a 10s timeout.

#### Step 3 — Registry Fallback

If service install fails (UAC declined, policy blocked, not admin, elevation timeout):

```go
func installRegistryRunKey(binaryPath string) error {
    key, err := registry.OpenKey(
        registry.CURRENT_USER,
        `Software\Microsoft\Windows\CurrentVersion\Run`,
        registry.SET_VALUE,
    )
    if err != nil {
        return fmt.Errorf("open Run key: %w", err)
    }
    defer key.Close()
    return key.SetStringValue("TimeChampAgent", `"`+binaryPath+`"`)
}
```

Uses `golang.org/x/sys/windows/registry`. HKCU requires no elevation.

#### Step 4 — Start Agent

After service or registry install:
```go
// If service was installed: sc start TimeChampAgent
// If registry only: exec.Command(binaryPath) with CREATE_NEW_PROCESS_GROUP
// Either way, detached from setup process
```

---

### Setup Wizard Enhancement (`cmd/setup/main.go`)

#### Server-Sent Events for Live Progress

Replace the current fire-and-forget `/register` handler with SSE streaming:

```go
// GET /register-stream — SSE endpoint, called by browser EventSource
mux.HandleFunc("/register-stream", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")

    send := func(step, msg string) {
        fmt.Fprintf(w, "data: %s\n\n", toJSON(step, msg))
        w.(http.Flusher).Flush()
    }

    send("connect",   "Checking connection…")
    // ... ping API
    send("register",  "Registering device…")
    // ... call agentsync.Register()
    send("creds",     "Saving credentials…")
    // ... keychain.SaveToken(), config.SaveIdentity()
    send("install",   "Installing agent…")
    // ... selfinstall.Install() — streams its own progress via channel
    send("verify",    "Verifying agent is running…")
    // ... waitForHealth(15s)
    send("done",      "Agent is running!")
})
```

#### Updated UI (`ui/index.html`)

Live step list — each step lights up as it completes:
```
○ Checking connection
○ Registering device
○ Installing agent binary
○ Configuring auto-start
○ Starting agent
○ Verifying health
✓ Done — agent is running in the background
```

Each `○` turns `✓` in real time via SSE. On failure, the failed step turns red with the error message and a specific action for the user to take.

---

### Error Messages — Actionable, Not Generic

| Failure | Message shown |
|---|---|
| API unreachable | "Cannot reach `<url>`. Check the URL is correct and the server is running." |
| Invalid invite token | "Invite token is invalid or already used. Generate a new one in the dashboard." |
| Keychain write fails | "Cannot save credentials to keychain. Check System Preferences → Privacy → Keychain." |
| Quarantine strip fails | "Could not remove macOS security flag. Right-click the app and choose Open, then try again." |
| MDM blocked (macOS) | "Your organisation's IT policy is blocking background agents. Contact your IT admin and share this error code: MDM-125." |
| Health check timeout | "Agent did not start within 15 seconds. Check `~/Library/Logs/TimeChamp/agent_error.log` for details." |
| Registry write fails (Win) | "Could not configure auto-start. Run the setup as Administrator or contact IT." |

---

## File Changelist

| File | Change |
|---|---|
| `internal/selfinstall/selfinstall.go` | **New** — Config, Result, Install(), waitForHealth() |
| `internal/selfinstall/selfinstall_darwin.go` | **New** — installBinary, stripQuarantine, writePlist, bootstrapAgent, requestPermissions |
| `internal/selfinstall/selfinstall_windows.go` | **New** — installBinary, installService, UAC elevation, installRegistryRunKey |
| `internal/selfinstall/selfinstall_other.go` | **New** — no-op stub |
| `cmd/setup/main.go` | **Modify** — replace `/register` with SSE `/register-stream`, call selfinstall.Install() |
| `cmd/setup/ui/index.html` | **Modify** — SSE-driven live step progress, actionable error messages |
| `internal/service/service_darwin.go` | **Modify** — fix `launchctl load` → `launchctl bootstrap`, add kickstart |

---

## Testing Strategy

- `internal/selfinstall` has no external dependencies in its core logic — binary write, plist render, and registry write are all testable with mock paths
- `selfinstall_darwin.go`: test plist template rendering, quarantine strip invocation, MDM error detection
- `selfinstall_windows.go`: test registry write, service-exists check, handoff file read/write
- `waitForHealth()`: tested with mock HTTP server
- Manual smoke test: fresh macOS VM (Ventura + Sequoia), fresh Windows 10 + 11 VM — run setup, reboot, verify agent is running after reboot

---

## Constants

| Constant | Value | Reason |
|---|---|---|
| Health poll interval | 500ms | Fast enough to feel instant |
| Health poll timeout | 15s | Covers slow machines + cold start |
| Service install timeout | 10s | UAC + service start on slow machines |
| ThrottleInterval | 10s | Prevents launchd restart storms |
| Atomic write retry | 3× / 500ms | AV file lock on Windows |
| ExitTimeout (plist) | 10s | Gives agent time to flush buffers on launchd stop |
