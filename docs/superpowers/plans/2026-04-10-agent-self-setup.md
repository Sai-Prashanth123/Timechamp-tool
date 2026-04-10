# Agent Self-Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TimeChamp agent permanently install itself as an OS background service (macOS LaunchAgent or Windows Service/registry) during setup, with real-time SSE progress feedback and zero additional user action required after registration.

**Architecture:** A new `internal/selfinstall` package encapsulates all OS-specific installation logic behind a single `Install(cfg, progress)` call. Three platform files (darwin, windows, other) implement the same three private functions (`platformInstallBinary`, `platformConfigureAutoStart`, `platformStartAgent`) via Go build tags. The setup wizard's `cmd/setup/main.go` gains a `/register-stream` SSE endpoint that streams live step progress to the browser, replacing the current fire-and-forget `/register` POST. Health verification (HTTP poll of the agent's `/health` endpoint) is the final gate — success is reported only once the agent is confirmed running.

**Tech Stack:** Go 1.22, `golang.org/x/sys/unix` (macOS quarantine strip), `golang.org/x/sys/windows/registry` (HKCU Run key), `golang.org/x/sys/windows/svc/mgr` (Windows SCM), `text/template` (plist rendering), `net/http` Server-Sent Events (browser progress).

---

## File Structure

**New files:**
| Path | Responsibility |
|---|---|
| `apps/agent/internal/selfinstall/selfinstall.go` | `Config`, `Result`, `Install()` orchestration, `waitForHealth()`, `sendProgress()` helper |
| `apps/agent/internal/selfinstall/selfinstall_darwin.go` | macOS: `platformInstallBinary`, `platformConfigureAutoStart` (plist + launchctl), `platformStartAgent` |
| `apps/agent/internal/selfinstall/selfinstall_windows.go` | Windows: `platformInstallBinary`, `platformConfigureAutoStart` (UAC service + registry fallback), `platformStartAgent` |
| `apps/agent/internal/selfinstall/selfinstall_other.go` | Linux/other no-op stub |
| `apps/agent/internal/selfinstall/selfinstall_test.go` | `waitForHealth` tests with mock HTTP server |
| `apps/agent/internal/selfinstall/selfinstall_darwin_test.go` | plist template render, MDM error detection |
| `apps/agent/internal/selfinstall/selfinstall_windows_test.go` | registry write, handoff file round-trip |

**Modified files:**
| Path | Change |
|---|---|
| `apps/agent/internal/service/service_darwin.go` | Replace deprecated `launchctl load -w` with `launchctl bootstrap gui/UID`; update plist template with `ProcessType`, `AssociatedBundleIdentifiers`, `TC_API_URL`, `HOME`, `ExitTimeout` |
| `apps/agent/cmd/setup/main.go` | Add `--install-service` flag handler (Windows UAC re-exec); replace `/register` POST with `/register-stream` SSE; fix `apiURL` not passed to `SaveIdentity` |
| `apps/agent/cmd/setup/ui/index.html` | EventSource-based 6-step live progress UI with actionable per-step error messages |

---

## Task 1: `internal/selfinstall/selfinstall.go` — shared types and orchestration

**Files:**
- Create: `apps/agent/internal/selfinstall/selfinstall.go`
- Create: `apps/agent/internal/selfinstall/selfinstall_test.go`

- [ ] **Step 1: Create `selfinstall.go` with Config, Result, Install(), and helpers**

Create `apps/agent/internal/selfinstall/selfinstall.go`:

```go
// Package selfinstall installs the agent binary and registers it for
// permanent background operation on the host OS. It is called by the setup
// wizard after successful device registration.
//
// Each platform provides three private functions:
//   - platformInstallBinary(cfg Config) (binaryPath string, err error)
//   - platformConfigureAutoStart(binaryPath, apiURL string) (mode string, warnings []string, err error)
//   - platformStartAgent(binaryPath, apiURL string) error
//
// This file contains only the shared orchestration and health-poll logic.
package selfinstall

import (
	"fmt"
	"net/http"
	"time"
)

// Config is everything Install() needs — passed from the setup wizard after
// device registration completes.
type Config struct {
	// BinaryData is the raw bytes of the agent executable (from //go:embed).
	BinaryData []byte
	// APIURL is the base API URL entered by the user (e.g. https://api.timechamp.io/api/v1).
	APIURL string
	// DataDir is the OS platform data directory (e.g. ~/Library/Application Support/TimeChamp).
	DataDir string
}

// Result describes what Install() did — used for UI feedback and audit logging.
type Result struct {
	// BinaryPath is the absolute path where the agent binary was written.
	BinaryPath string
	// AutoStartMode is one of: "launchd", "windows-service", "registry", "none".
	AutoStartMode string
	// AlreadySetUp is true if the agent was already correctly installed.
	AlreadySetUp bool
	// Warnings contains non-fatal issues (e.g. MDM restriction detected).
	Warnings []string
}

// healthURL is the agent health endpoint. Overridden in tests.
var healthURL = "http://127.0.0.1:27183/health"

// Install registers the agent for permanent background operation on the
// current OS. It is idempotent: safe to call multiple times.
//
// progress receives human-readable step descriptions as they complete.
// Pass nil if you do not need progress events.
// Returns error only on unrecoverable failure.
func Install(cfg Config, progress chan<- string) (Result, error) {
	sendProgress(progress, "Installing agent binary…")
	binaryPath, err := platformInstallBinary(cfg)
	if err != nil {
		return Result{}, fmt.Errorf("install binary: %w", err)
	}

	sendProgress(progress, "Configuring auto-start…")
	mode, warnings, err := platformConfigureAutoStart(binaryPath, cfg.APIURL)
	if err != nil {
		return Result{}, fmt.Errorf("configure auto-start: %w", err)
	}

	sendProgress(progress, "Starting agent…")
	if err := platformStartAgent(binaryPath, cfg.APIURL); err != nil {
		return Result{}, fmt.Errorf("start agent: %w", err)
	}

	sendProgress(progress, "Verifying agent health…")
	if err := waitForHealth(15 * time.Second); err != nil {
		return Result{}, fmt.Errorf("health check: %w — check logs in the agent data directory for details")
	}

	return Result{
		BinaryPath:    binaryPath,
		AutoStartMode: mode,
		Warnings:      warnings,
	}, nil
}

// waitForHealth polls the agent health endpoint every 500 ms until it
// responds 200 OK or the timeout expires.
func waitForHealth(timeout time.Duration) error {
	client := &http.Client{Timeout: 3 * time.Second}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := client.Get(healthURL)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("agent did not respond healthy within %v", timeout)
}

// sendProgress sends msg to ch without blocking. Nil ch is safe.
func sendProgress(ch chan<- string, msg string) {
	if ch == nil {
		return
	}
	select {
	case ch <- msg:
	default:
	}
}
```

- [ ] **Step 2: Write tests for `waitForHealth`**

Create `apps/agent/internal/selfinstall/selfinstall_test.go`:

```go
package selfinstall

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestWaitForHealth_SucceedsImmediately(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	old := healthURL
	healthURL = srv.URL
	defer func() { healthURL = old }()

	if err := waitForHealth(2 * time.Second); err != nil {
		t.Fatalf("expected success, got %v", err)
	}
}

func TestWaitForHealth_RetriesUntilReady(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	old := healthURL
	healthURL = srv.URL
	defer func() { healthURL = old }()

	if err := waitForHealth(5 * time.Second); err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if calls < 3 {
		t.Fatalf("expected at least 3 calls, got %d", calls)
	}
}

func TestWaitForHealth_TimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	old := healthURL
	healthURL = srv.URL
	defer func() { healthURL = old }()

	if err := waitForHealth(1200 * time.Millisecond); err == nil {
		t.Fatal("expected timeout error, got nil")
	}
}

func TestSendProgress_NilChannelDoesNotPanic(t *testing.T) {
	// Must not block or panic.
	sendProgress(nil, "hello")
}

func TestSendProgress_DeliversMessage(t *testing.T) {
	ch := make(chan string, 1)
	sendProgress(ch, "step complete")
	if got := <-ch; got != "step complete" {
		t.Fatalf("got %q", got)
	}
}
```

- [ ] **Step 3: Run tests (expect FAIL — platform functions not yet defined)**

```bash
cd apps/agent
go test ./internal/selfinstall/... 2>&1 | head -20
```

Expected output: `undefined: platformInstallBinary` (or similar build error). This confirms the test file compiles and the missing stubs are the only gap.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/internal/selfinstall/selfinstall.go apps/agent/internal/selfinstall/selfinstall_test.go
git commit -m "feat(selfinstall): add Config, Result, Install() orchestration, waitForHealth"
```

---

## Task 2: `internal/selfinstall/selfinstall_other.go` — no-op stub

**Files:**
- Create: `apps/agent/internal/selfinstall/selfinstall_other.go`

- [ ] **Step 1: Create the stub**

Create `apps/agent/internal/selfinstall/selfinstall_other.go`:

```go
//go:build !darwin && !windows

package selfinstall

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// platformInstallBinary writes the binary to DataDir and returns its path.
// On Linux, users install via systemd user unit (separate flow); this stub
// covers any other GOOS that might sneak in.
func platformInstallBinary(cfg Config) (string, error) {
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", cfg.DataDir, err)
	}
	name := "timechamp-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(cfg.DataDir, name)
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, cfg.BinaryData, 0755); err != nil {
		return "", fmt.Errorf("write binary: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", err)
	}
	return dest, nil
}

// platformConfigureAutoStart is a no-op on non-darwin/non-windows platforms.
// Linux auto-start is handled via systemd user units in the separate installer CLI.
func platformConfigureAutoStart(binaryPath, apiURL string) (string, []string, error) {
	return "none", nil, nil
}

// platformStartAgent launches the agent detached from the current process.
func platformStartAgent(binaryPath, apiURL string) error {
	cmd := newDetachedCmd(binaryPath, apiURL)
	return cmd.Start()
}
```

- [ ] **Step 2: Add `newDetachedCmd` helper to the other stub**

Append to `selfinstall_other.go`:

```go
import "os/exec"

func newDetachedCmd(binaryPath, apiURL string) *exec.Cmd {
	cmd := exec.Command(binaryPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	return cmd
}
```

Wait — the import block needs to be at the top. Rewrite the file with both imports together:

```go
//go:build !darwin && !windows

package selfinstall

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func platformInstallBinary(cfg Config) (string, error) {
	if err := os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", cfg.DataDir, err)
	}
	name := "timechamp-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(cfg.DataDir, name)
	tmp := dest + ".tmp"
	if err := os.WriteFile(tmp, cfg.BinaryData, 0755); err != nil {
		return "", fmt.Errorf("write binary: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", err)
	}
	return dest, nil
}

func platformConfigureAutoStart(binaryPath, apiURL string) (string, []string, error) {
	return "none", nil, nil
}

func platformStartAgent(binaryPath, apiURL string) error {
	cmd := exec.Command(binaryPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	return cmd.Start()
}
```

(Write the file with the final content above — do not create it in two steps.)

- [ ] **Step 3: Build to verify no errors**

```bash
cd apps/agent
GOOS=linux go build ./internal/selfinstall/...
```

Expected: no output (clean build).

- [ ] **Step 4: Commit**

```bash
git add apps/agent/internal/selfinstall/selfinstall_other.go
git commit -m "feat(selfinstall): add Linux/other no-op stub"
```

---

## Task 3: `internal/selfinstall/selfinstall_darwin.go` — macOS implementation

**Files:**
- Create: `apps/agent/internal/selfinstall/selfinstall_darwin.go`
- Create: `apps/agent/internal/selfinstall/selfinstall_darwin_test.go`

- [ ] **Step 1: Write the failing plist render test**

Create `apps/agent/internal/selfinstall/selfinstall_darwin_test.go`:

```go
//go:build darwin

package selfinstall

import (
	"strings"
	"testing"
)

func TestRenderPlist_ContainsRequiredKeys(t *testing.T) {
	rendered, err := renderPlist(plistData{
		BinaryPath: "/Users/test/Library/Application Support/TimeChamp/timechamp-agent",
		LogDir:     "/Users/test/Library/Logs/TimeChamp",
		APIURL:     "https://api.timechamp.io/api/v1",
		Home:       "/Users/test",
	})
	if err != nil {
		t.Fatalf("renderPlist error: %v", err)
	}

	requiredStrings := []string{
		"com.timechamp.agent",
		"timechamp-agent",
		"RunAtLoad",
		"KeepAlive",
		"ProcessType",
		"Background",
		"ThrottleInterval",
		"AssociatedBundleIdentifiers",
		"com.timechamp.setup",
		"TC_API_URL",
		"https://api.timechamp.io/api/v1",
		"HOME",
		"/Users/test",
		"ExitTimeout",
		"agent.log",
		"agent_error.log",
	}
	for _, s := range requiredStrings {
		if !strings.Contains(rendered, s) {
			t.Errorf("plist missing %q\nGot:\n%s", s, rendered)
		}
	}
}

func TestIsMDMBlocked_DetectsError125(t *testing.T) {
	if !isMDMBlocked("125", "some launchctl output") {
		t.Error("expected MDM detection for exit code 125")
	}
}

func TestIsMDMBlocked_DetectsNotPermitted(t *testing.T) {
	if !isMDMBlocked("", "Operation not permitted by MDM policy") {
		t.Error("expected MDM detection for 'not permitted' message")
	}
}

func TestIsMDMBlocked_FalseForNormalError(t *testing.T) {
	if isMDMBlocked("1", "some other launchctl error") {
		t.Error("false positive MDM detection")
	}
}
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd apps/agent
GOOS=darwin go test ./internal/selfinstall/... -run TestRenderPlist 2>&1 | head -10
```

Expected: `FAIL — undefined: renderPlist`

- [ ] **Step 3: Implement `selfinstall_darwin.go`**

Create `apps/agent/internal/selfinstall/selfinstall_darwin.go`:

```go
//go:build darwin

package selfinstall

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"text/template"

	"golang.org/x/sys/unix"
)

const (
	launchAgentLabel  = "com.timechamp.agent"
	bundleIdentifier  = "com.timechamp.setup"
)

// plistData holds template variables for the LaunchAgent plist.
type plistData struct {
	BinaryPath string
	LogDir     string
	APIURL     string
	Home       string
}

const launchAgentPlistTmpl = `<?xml version="1.0" encoding="UTF-8"?>
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
`

// renderPlist executes the plist template and returns the rendered XML string.
func renderPlist(data plistData) (string, error) {
	tmpl, err := template.New("plist").Parse(launchAgentPlistTmpl)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// isMDMBlocked returns true when launchctl output indicates MDM policy blocked
// the operation (exit code 125 or "not permitted" message).
func isMDMBlocked(exitCode, output string) bool {
	return exitCode == "125" ||
		strings.Contains(strings.ToLower(output), "not permitted")
}

// darwinHome returns the user home directory. Falls back through candidates so
// we never return an empty string that would point to the filesystem root.
func darwinHome() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	for _, c := range []string{"/Users/" + os.Getenv("USER"), "/var/root"} {
		if c != "/Users/" {
			if _, err := os.Stat(c); err == nil {
				return c
			}
		}
	}
	return "/tmp"
}

// platformInstallBinary writes the agent binary to
// ~/Library/Application Support/TimeChamp/ using an atomic temp-rename,
// then strips the Gatekeeper quarantine extended attribute.
func platformInstallBinary(cfg Config) (string, error) {
	home := darwinHome()
	dir := filepath.Join(home, "Library", "Application Support", "TimeChamp")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", dir, err)
	}

	dest := filepath.Join(dir, "timechamp-agent")
	tmp := dest + ".tmp"

	if err := os.WriteFile(tmp, cfg.BinaryData, 0755); err != nil {
		return "", fmt.Errorf("write binary: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", err)
	}

	stripQuarantine(dest)
	return dest, nil
}

// stripQuarantine removes the com.apple.quarantine extended attribute that
// macOS adds to downloaded files, which would cause Gatekeeper to block
// first-run. Uses xattr CLI as primary (always present) and syscall as fallback.
func stripQuarantine(path string) {
	// Primary: xattr -d removes the specific attribute; -c clears all xattrs.
	exec.Command("xattr", "-d", "com.apple.quarantine", path).Run() //nolint:errcheck
	exec.Command("xattr", "-c", path).Run()                          //nolint:errcheck
	// Fallback: direct syscall (golang.org/x/sys/unix).
	unix.Removexattr(path, "com.apple.quarantine") //nolint:errcheck
}

// platformConfigureAutoStart writes the LaunchAgent plist and registers it
// with launchd using the modern `launchctl bootstrap gui/UID` API.
// Falls back to the deprecated `launchctl load -w` for macOS < 10.15.
// Detects MDM policy blocks and returns a warning instead of an error.
func platformConfigureAutoStart(binaryPath, apiURL string) (string, []string, error) {
	home := darwinHome()

	logDir := filepath.Join(home, "Library", "Logs", "TimeChamp")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return "", nil, fmt.Errorf("create log dir: %w", err)
	}

	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(plistDir, 0755); err != nil {
		return "", nil, fmt.Errorf("create LaunchAgents dir: %w", err)
	}
	plistFile := filepath.Join(plistDir, launchAgentLabel+".plist")

	rendered, err := renderPlist(plistData{
		BinaryPath: binaryPath,
		LogDir:     logDir,
		APIURL:     apiURL,
		Home:       home,
	})
	if err != nil {
		return "", nil, fmt.Errorf("render plist: %w", err)
	}

	// Atomic plist write: temp file + rename to avoid partial reads by launchd.
	tmp := plistFile + ".tmp"
	if err := os.WriteFile(tmp, []byte(rendered), 0644); err != nil {
		return "", nil, fmt.Errorf("write plist: %w", err)
	}
	if err := os.Rename(tmp, plistFile); err != nil {
		_ = os.Remove(tmp)
		return "", nil, fmt.Errorf("rename plist: %w", err)
	}

	warnings, err := bootstrapAgent(plistFile, binaryPath)
	if err != nil {
		return "", warnings, err
	}

	// Open Screen Recording privacy pane so the user can grant permission
	// before the agent's first screenshot attempt. Non-blocking — the agent
	// re-checks permissions every 60 s internally. CGRequestScreenCaptureAccess
	// is GUI-only; from a CLI binary we open System Settings directly instead.
	requestPermissions()

	return "launchd", warnings, nil
}

// bootstrapAgent registers and starts the LaunchAgent using launchctl.
// Order of operations:
//  1. If already loaded → kickstart (restart in case binary changed)
//  2. macOS 10.15+ bootstrap gui/UID domain
//  3. Detect MDM block (exit 125 / "not permitted") → direct-launch fallback
//  4. Fall back to deprecated launchctl load -w (macOS < 10.15)
//
// binaryPath is needed for the MDM direct-launch fallback — when launchctl is
// blocked by corporate policy, we exec the binary directly so it runs for
// the current session even though it will not survive reboot.
func bootstrapAgent(plistPath, binaryPath string) (warnings []string, err error) {
	uid := os.Getuid()

	// Check if already loaded.
	out, _ := exec.Command("launchctl", "list", launchAgentLabel).CombinedOutput()
	if strings.Contains(string(out), launchAgentLabel) {
		// Already registered — kickstart to pick up any binary change.
		exec.Command("launchctl", "kickstart", "-k", //nolint:errcheck
			fmt.Sprintf("gui/%d/%s", uid, launchAgentLabel)).Run()
		return nil, nil
	}

	// macOS 10.15+ (Catalina and newer): bootstrap gui domain.
	out, bootstrapErr := exec.Command(
		"launchctl", "bootstrap",
		fmt.Sprintf("gui/%d", uid),
		plistPath,
	).CombinedOutput()

	if bootstrapErr == nil {
		return nil, nil
	}

	// Detect MDM / corporate policy block.
	exitCode := ""
	if exitErr, ok := bootstrapErr.(*exec.ExitError); ok {
		exitCode = fmt.Sprintf("%d", exitErr.ExitCode())
	}
	if isMDMBlocked(exitCode, string(out)) {
		// Best-effort: launch the binary directly so it runs this session.
		// It will NOT survive reboot — user must contact IT to whitelist.
		cmd := exec.Command(binaryPath) //nolint:errcheck
		cmd.Env = append(os.Environ())
		cmd.Start() //nolint:errcheck
		return []string{
			"MDM_BLOCKED: Your organisation's IT policy blocked background agent registration. " +
				"Contact IT and share error code MDM-125. " +
				"The agent will run until next reboot.",
		}, nil
	}

	// Fallback: deprecated launchctl load (macOS < 10.15 or unusual environments).
	out2, loadErr := exec.Command("launchctl", "load", "-w", plistPath).CombinedOutput()
	if loadErr != nil {
		return nil, fmt.Errorf("launchctl load: %w — %s", loadErr, out2)
	}
	return nil, nil
}

// platformStartAgent is a no-op on macOS: launchctl bootstrap already started
// the agent as part of platformConfigureAutoStart.
func platformStartAgent(binaryPath, apiURL string) error {
	// launchd manages the process. If it did not start (e.g. MDM blocked),
	// waitForHealth will time out and report a clear error.
	return nil
}

// requestPermissions opens System Settings to the Screen Recording privacy
// pane so the user can grant permission without hunting through menus.
// Non-blocking — the agent re-checks permissions every 60 s internally.
func requestPermissions() {
	exec.Command("open", //nolint:errcheck
		"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
	).Start()
}

// NOTE: Do NOT add an isScreenRecordingGranted() function. CGRequestScreenCaptureAccess
// is GUI-only and unusable from a CLI binary. requestPermissions() is called
// unconditionally — opening System Settings is always safe and non-blocking.
```

Note: the `syscall` import at the bottom is a placeholder — remove it if it causes "imported and not used". The `unix.Removexattr` call in `stripQuarantine` uses the `golang.org/x/sys/unix` package.

Actually, rewrite the import block cleanly without the unused `syscall` placeholder:

```go
import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"

	"golang.org/x/sys/unix"
)
```

(Remove the `syscall` import entirely — it was a mistake in the draft above.)

- [ ] **Step 4: Run the darwin tests**

```bash
cd apps/agent
GOOS=darwin go test ./internal/selfinstall/... -run "TestRenderPlist|TestIsMDMBlocked" -v
```

Expected:
```
--- PASS: TestRenderPlist_ContainsRequiredKeys (0.00s)
--- PASS: TestIsMDMBlocked_DetectsError125 (0.00s)
--- PASS: TestIsMDMBlocked_DetectsNotPermitted (0.00s)
--- PASS: TestIsMDMBlocked_FalseForNormalError (0.00s)
PASS
```

- [ ] **Step 5: Cross-compile for darwin to verify no build errors**

```bash
cd apps/agent
GOOS=darwin GOARCH=arm64 go build ./internal/selfinstall/...
```

Expected: no output (clean build).

- [ ] **Step 6: Commit**

```bash
git add apps/agent/internal/selfinstall/selfinstall_darwin.go apps/agent/internal/selfinstall/selfinstall_darwin_test.go
git commit -m "feat(selfinstall): macOS implementation — quarantine strip, LaunchAgent plist, launchctl bootstrap"
```

---

## Task 4: `internal/selfinstall/selfinstall_windows.go` — Windows implementation

**Files:**
- Create: `apps/agent/internal/selfinstall/selfinstall_windows.go`
- Create: `apps/agent/internal/selfinstall/selfinstall_windows_test.go`

- [ ] **Step 1: Write failing tests**

Create `apps/agent/internal/selfinstall/selfinstall_windows_test.go`:

```go
//go:build windows

package selfinstall

import (
	"encoding/json"
	"os"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestHandoffRoundTrip(t *testing.T) {
	binaryPath := `C:\Users\test\AppData\Local\TimeChamp\timechamp-agent.exe`

	// Write handoff.
	path, err := writeHandoff(binaryPath)
	if err != nil {
		t.Fatalf("writeHandoff: %v", err)
	}
	defer os.Remove(path)

	// Read handoff.
	got, err := readHandoff(path)
	if err != nil {
		t.Fatalf("readHandoff: %v", err)
	}
	if got != binaryPath {
		t.Errorf("got %q, want %q", got, binaryPath)
	}
}

func TestInstallRegistryRunKey(t *testing.T) {
	// Write a Run key value.
	binaryPath := `C:\test\timechamp-agent.exe`
	if err := installRegistryRunKey(binaryPath); err != nil {
		t.Fatalf("installRegistryRunKey: %v", err)
	}
	defer func() {
		// Clean up.
		k, _ := registry.OpenKey(registry.CURRENT_USER,
			`Software\Microsoft\Windows\CurrentVersion\Run`,
			registry.SET_VALUE)
		k.DeleteValue("TimeChampAgent")
		k.Close()
	}()

	// Verify the value was written.
	k, err := registry.OpenKey(registry.CURRENT_USER,
		`Software\Microsoft\Windows\CurrentVersion\Run`,
		registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("OpenKey: %v", err)
	}
	defer k.Close()

	val, _, err := k.GetStringValue("TimeChampAgent")
	if err != nil {
		t.Fatalf("GetStringValue: %v", err)
	}
	want := `"` + binaryPath + `"`
	if val != want {
		t.Errorf("got %q, want %q", val, want)
	}
}

func TestHandoffJSON_IsValidJSON(t *testing.T) {
	f, err := os.CreateTemp("", "handoff-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())

	binaryPath := `C:\foo\bar.exe`
	data, _ := json.Marshal(map[string]string{"binaryPath": binaryPath})
	f.Write(data)
	f.Close()

	got, err := readHandoff(f.Name())
	if err != nil {
		t.Fatalf("readHandoff: %v", err)
	}
	if got != binaryPath {
		t.Errorf("got %q, want %q", got, binaryPath)
	}
}
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd apps/agent
go test ./internal/selfinstall/... -run "TestHandoff|TestInstallRegistry" 2>&1 | head -10
```

Expected: `FAIL — undefined: writeHandoff` (or similar).

- [ ] **Step 3: Implement `selfinstall_windows.go`**

Create `apps/agent/internal/selfinstall/selfinstall_windows.go`:

```go
//go:build windows

package selfinstall

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	windowsServiceName = "TimeChampAgent"
	windowsRegValueKey = "TimeChampAgent"
	windowsRegRunPath  = `Software\Microsoft\Windows\CurrentVersion\Run`
)

// platformInstallBinary writes the agent binary to
// %LOCALAPPDATA%\TimeChamp\timechamp-agent.exe using an atomic temp+rename.
// Rename on NTFS does NOT inherit Zone.Identifier ADS (SmartScreen bypass).
func platformInstallBinary(cfg Config) (string, error) {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	dir := filepath.Join(localAppData, "TimeChamp")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("mkdir %s: %w", dir, err)
	}

	dest := filepath.Join(dir, "timechamp-agent.exe")
	tmp := dest + ".tmp"

	// Retry up to 3 times (antivirus file locks).
	var writeErr error
	for range 3 {
		writeErr = os.WriteFile(tmp, cfg.BinaryData, 0755)
		if writeErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if writeErr != nil {
		return "", fmt.Errorf("write binary: %w", writeErr)
	}

	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", err)
	}
	return dest, nil
}

// platformConfigureAutoStart attempts to install a Windows Service (requires
// admin rights obtained via UAC elevation). If UAC is declined or unavailable,
// falls back to HKCU registry Run key (no elevation needed).
func platformConfigureAutoStart(binaryPath, apiURL string) (string, []string, error) {
	installed, err := installService(binaryPath)
	if err != nil {
		return "", nil, fmt.Errorf("service install: %w", err)
	}
	if installed {
		return "windows-service", nil, nil
	}

	// UAC declined or service install failed — registry fallback.
	if err := installRegistryRunKey(binaryPath); err != nil {
		return "", nil, fmt.Errorf("registry Run key: %w — "+
			"Run setup as Administrator or contact IT.", err)
	}
	return "registry", []string{
		"Windows Service installation was skipped (UAC declined or policy blocked). " +
			"The agent is configured to start via the registry Run key (user login only).",
	}, nil
}

// platformStartAgent starts the agent immediately after installation.
// If a service was installed, start it via SCM; otherwise launch detached.
func platformStartAgent(binaryPath, apiURL string) error {
	if serviceExists() {
		sm, err := mgr.Connect()
		if err != nil {
			return fmt.Errorf("connect SCM: %w", err)
		}
		defer sm.Disconnect()
		s, err := sm.OpenService(windowsServiceName)
		if err != nil {
			return fmt.Errorf("open service: %w", err)
		}
		defer s.Close()
		if startErr := s.Start(); startErr != nil {
			// Service may already be running — not a fatal error.
			_ = startErr
		}
		return nil
	}

	// Registry mode: launch as detached child process.
	cmd := exec.Command(binaryPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	return cmd.Start()
}

// ── Service install via UAC elevation ────────────────────────────────────────

// isAdmin returns true when the process has administrator privileges.
func isAdmin() bool {
	var sid *windows.SID
	if err := windows.AllocateAndInitializeSid(
		&windows.SECURITY_NT_AUTHORITY,
		2,
		windows.SECURITY_BUILTIN_DOMAIN_RID,
		windows.DOMAIN_ALIAS_RID_ADMINS,
		0, 0, 0, 0, 0, 0,
		&sid,
	); err != nil {
		return false
	}
	defer windows.FreeSid(sid)
	ok, err := windows.Token(0).IsMember(sid)
	return err == nil && ok
}

// serviceExists returns true if the TimeChampAgent Windows Service is registered.
func serviceExists() bool {
	sm, err := mgr.Connect()
	if err != nil {
		return false
	}
	defer sm.Disconnect()
	s, err := sm.OpenService(windowsServiceName)
	if err != nil {
		return false
	}
	s.Close()
	return true
}

// handoffPayload is the JSON written to the temp handoff file so the elevated
// re-exec knows which binary to register as a service.
type handoffPayload struct {
	BinaryPath string `json:"binaryPath"`
}

// writeHandoff writes binaryPath to a temp JSON file and returns its path.
func writeHandoff(binaryPath string) (string, error) {
	f, err := os.CreateTemp("", "tc-handoff-*.json")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if err := json.NewEncoder(f).Encode(handoffPayload{BinaryPath: binaryPath}); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// readHandoff reads a handoff file written by writeHandoff and returns the binaryPath.
// Deletes the file after reading.
func readHandoff(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	os.Remove(path) //nolint:errcheck — best effort
	var p handoffPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return "", err
	}
	return p.BinaryPath, nil
}

// installService tries to install a Windows Service by re-launching self
// with UAC elevation (ShellExecute runas). Returns (true, nil) if installed,
// (false, nil) if UAC was declined or timed out.
func installService(binaryPath string) (bool, error) {
	if isAdmin() {
		return true, doInstallService(binaryPath)
	}

	// Write handoff so the elevated process knows what to install.
	handoffPath, err := writeHandoff(binaryPath)
	if err != nil {
		return false, fmt.Errorf("write handoff: %w", err)
	}

	// Re-launch ourselves elevated with --install-service flag.
	exe, err := os.Executable()
	if err != nil {
		return false, fmt.Errorf("os.Executable: %w", err)
	}

	if err := shellExecuteRunas(exe, "--install-service "+handoffPath); err != nil {
		// UAC was declined or ShellExecute failed — fall through to registry.
		os.Remove(handoffPath) //nolint:errcheck
		return false, nil
	}

	// Poll for service to appear (up to 10 s).
	for range 20 {
		time.Sleep(500 * time.Millisecond)
		if serviceExists() {
			return true, nil
		}
	}
	return false, nil
}

// doInstallService installs the Windows Service using SCM. Called either
// directly (if already admin) or by the elevated re-exec process.
func doInstallService(binaryPath string) error {
	sm, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect SCM: %w", err)
	}
	defer sm.Disconnect()

	// Idempotent: if service already exists, do nothing.
	if existing, err := sm.OpenService(windowsServiceName); err == nil {
		existing.Close()
		return nil
	}

	config := mgr.Config{
		StartType:        mgr.StartAutomatic,
		DisplayName:      "Time Champ Agent",
		Description:      "Time Champ productivity monitoring agent",
		BinaryPathName:   binaryPath,
		ServiceStartName: "LocalSystem",
	}
	s, err := sm.CreateService(windowsServiceName, binaryPath, config)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer s.Close()
	return nil
}

// shellExecuteRunas re-launches exe with admin rights via Windows ShellExecute.
// Returns error if the user declines UAC or the shell call fails.
func shellExecuteRunas(exe, args string) error {
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(exe)
	params, _ := syscall.UTF16PtrFromString(args)
	ret, _ := windows.ShellExecute(0, verb, file, params, nil, windows.SW_HIDE)
	if uintptr(ret) <= 32 {
		return fmt.Errorf("ShellExecute runas returned %d (UAC declined or unavailable)", uintptr(ret))
	}
	return nil
}

// installRegistryRunKey writes the agent binary path to
// HKCU\Software\Microsoft\Windows\CurrentVersion\Run so the agent starts
// at user login. Requires no elevation.
func installRegistryRunKey(binaryPath string) error {
	k, err := registry.OpenKey(
		registry.CURRENT_USER,
		windowsRegRunPath,
		registry.SET_VALUE,
	)
	if err != nil {
		return fmt.Errorf("open Run key: %w", err)
	}
	defer k.Close()
	// Quote the path to handle spaces in %LOCALAPPDATA%.
	return k.SetStringValue(windowsRegValueKey, `"`+binaryPath+`"`)
}
```

- [ ] **Step 4: Run the windows tests**

```bash
cd apps/agent
go test ./internal/selfinstall/... -run "TestHandoff|TestInstallRegistry" -v
```

Expected:
```
--- PASS: TestHandoffRoundTrip (0.00s)
--- PASS: TestHandoffJSON_IsValidJSON (0.00s)
--- PASS: TestInstallRegistryRunKey (0.00s)
PASS
```

- [ ] **Step 5: Run all selfinstall tests**

```bash
cd apps/agent
go test ./internal/selfinstall/... -v
```

Expected: all tests pass (darwin-tagged tests skipped on Windows — that is correct).

- [ ] **Step 6: Build to verify no Windows compile errors**

```bash
cd apps/agent
go build ./internal/selfinstall/...
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add apps/agent/internal/selfinstall/selfinstall_windows.go apps/agent/internal/selfinstall/selfinstall_windows_test.go
git commit -m "feat(selfinstall): Windows implementation — UAC service install, NTFS atomic binary, HKCU registry fallback"
```

---

## Task 5: Fix `internal/service/service_darwin.go` — modernize launchctl

**Files:**
- Modify: `apps/agent/internal/service/service_darwin.go`

Context: The existing `service_darwin.go` uses `launchctl load -w` which is deprecated since macOS 10.14 and silently does nothing on macOS 13+ Ventura. The plist template is also missing `ProcessType`, `AssociatedBundleIdentifiers`, `TC_API_URL`, `HOME`, and `ExitTimeout`. This file is used by the CLI installer (`cmd/installer`), separate from `selfinstall`.

- [ ] **Step 1: Update the plist template**

In `apps/agent/internal/service/service_darwin.go`, replace the `launchAgentPlistTemplate` constant (lines 18–53) with:

```go
const launchAgentPlistTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{{.Label}}</string>

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

    <key>AssociatedBundleIdentifiers</key>
    <array>
        <string>com.timechamp.installer</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
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
`
```

- [ ] **Step 2: Update the template data struct to include `Home`**

In `service_darwin.go`, find the `data := struct { ... }` block in `Install()` (around line 103) and add the `Home` field:

```go
data := struct {
    Label      string
    BinaryPath string
    LogDir     string
    Home       string
}{launchAgentLabel, absPath, ldir, userHome()}
```

- [ ] **Step 3: Replace `launchctl load -w` with `launchctl bootstrap gui/UID`**

Replace the `Install()` method's launchctl call (around line 124–130):

**Old:**
```go
// Load immediately.
out, err := exec.Command("launchctl", "load", "-w", plistPath()).CombinedOutput()
if err != nil {
    return fmt.Errorf("launchctl load: %w — %s", err, out)
}
```

**New:**
```go
uid := os.Getuid()
guiDomain := fmt.Sprintf("gui/%d", uid)

// Check if already loaded; kickstart if so.
listOut, _ := exec.Command("launchctl", "list", launchAgentLabel).CombinedOutput()
if strings.Contains(string(listOut), launchAgentLabel) {
    exec.Command("launchctl", "kickstart", "-k", //nolint:errcheck
        fmt.Sprintf("%s/%s", guiDomain, launchAgentLabel)).Run()
    return nil
}

// macOS 10.15+ bootstrap.
out, err := exec.Command("launchctl", "bootstrap", guiDomain, plistPath()).CombinedOutput()
if err != nil {
    // Fallback: deprecated load for older macOS.
    out2, err2 := exec.Command("launchctl", "load", "-w", plistPath()).CombinedOutput()
    if err2 != nil {
        return fmt.Errorf("launchctl bootstrap: %w (%s); load fallback: %w (%s)",
            err, out, err2, out2)
    }
}
```

- [ ] **Step 4: Update `Uninstall()` to use `launchctl bootout`**

Replace the unload call in `Uninstall()`:

**Old:**
```go
out, err := exec.Command("launchctl", "unload", "-w", path).CombinedOutput()
if err != nil {
    return fmt.Errorf("launchctl unload: %w — %s", err, out)
}
```

**New:**
```go
uid := os.Getuid()
guiDomain := fmt.Sprintf("gui/%d", uid)
// Modern bootout; fall back to deprecated unload on older macOS.
out, err := exec.Command("launchctl", "bootout", guiDomain, path).CombinedOutput()
if err != nil {
    out2, err2 := exec.Command("launchctl", "unload", "-w", path).CombinedOutput()
    if err2 != nil {
        return fmt.Errorf("launchctl bootout: %w (%s); unload fallback: %w (%s)",
            err, out, err2, out2)
    }
}
```

- [ ] **Step 5: Update `Start()` to use `launchctl kickstart`**

Replace the `Start()` method body:

**Old:**
```go
out, err := exec.Command("launchctl", "start", launchAgentLabel).CombinedOutput()
if err != nil {
    return fmt.Errorf("launchctl start: %w — %s", err, out)
}
return nil
```

**New:**
```go
uid := os.Getuid()
target := fmt.Sprintf("gui/%d/%s", uid, launchAgentLabel)
out, err := exec.Command("launchctl", "kickstart", "-k", target).CombinedOutput()
if err != nil {
    return fmt.Errorf("launchctl kickstart: %w — %s", err, out)
}
return nil
```

- [ ] **Step 6: Cross-compile to verify no errors**

```bash
cd apps/agent
GOOS=darwin GOARCH=arm64 go build ./internal/service/...
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add apps/agent/internal/service/service_darwin.go
git commit -m "fix(service): replace deprecated launchctl load with bootstrap; update plist with ProcessType, AssociatedBundleIdentifiers, ExitTimeout"
```

---

## Task 6: `cmd/setup/main.go` — SSE endpoint and selfinstall integration

**Files:**
- Modify: `apps/agent/cmd/setup/main.go`

Context: The current `/register` POST handler fire-and-forgets — it extracts the binary and calls `cmd.Start()` with no health verification, no auto-start registration, and no live progress. Replace it with an SSE `/register-stream` GET endpoint that streams progress events and calls `selfinstall.Install()`.

Also add a `--install-service` flag handler at the top of `main()` for the Windows UAC re-exec path (selfinstall elevates setup.exe with this flag to install the Windows Service as admin).

- [ ] **Step 1: Add the `--install-service` flag handler and update imports**

Replace the entire `apps/agent/cmd/setup/main.go` with:

```go
// Package main is the TimeChamp Agent setup wizard.
// Opens a local browser page — no terminal, no dialogs, works on Windows/macOS/Linux.
// The agent binary is embedded at compile time; CI replaces agent_bin before building.
//
// Windows UAC re-exec: when selfinstall needs admin to install a Windows Service,
// it re-launches this binary with --install-service <handoff-path>. The elevated
// process reads the handoff, installs the service, and exits immediately.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/selfinstall"
	agentsync "github.com/timechamp/agent/internal/sync"
)

//go:embed ui/index.html
var indexHTML []byte

//go:embed agent_bin
var agentBinary []byte

func main() {
	// Windows UAC re-exec: install service from elevated process and exit.
	if len(os.Args) == 3 && os.Args[1] == "--install-service" {
		handleInstallService(os.Args[2])
		return
	}

	cfg := config.Load()

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	done := make(chan struct{}, 1)

	mux := http.NewServeMux()

	// ── Serve setup page ────────────────────────────────────────────────────
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})

	// ── Ping: verify API is reachable ────────────────────────────────────────
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		apiURL := r.URL.Query().Get("apiUrl")
		if apiURL == "" {
			apiURL = cfg.APIURL
		}
		client := &http.Client{Timeout: 8 * time.Second}
		resp, err := client.Get(apiURL + "/health")
		if err != nil || resp.StatusCode >= 500 {
			jsonErr(w, "Cannot reach the API server. Check the URL and ensure it is running.", http.StatusServiceUnavailable)
			return
		}
		resp.Body.Close()
		jsonOK(w, "ok")
	})

	// ── Register stream: SSE endpoint — authenticate + install + verify ─────
	mux.HandleFunc("/register-stream", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("Access-Control-Allow-Origin", "http://127.0.0.1")

		apiURL := r.URL.Query().Get("apiUrl")
		if apiURL == "" {
			apiURL = cfg.APIURL
		}
		token := r.URL.Query().Get("token")

		send := func(step, msg string) {
			data, _ := json.Marshal(map[string]string{"step": step, "msg": msg})
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
		sendErr := func(step, errMsg string) {
			data, _ := json.Marshal(map[string]string{"step": step, "error": errMsg})
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}

		// ── Step: connect ────────────────────────────────────────────────────
		send("connect", "Checking connection…")
		client := &http.Client{Timeout: 8 * time.Second}
		resp, err := client.Get(apiURL + "/health")
		if err != nil {
			sendErr("connect", fmt.Sprintf(
				"Cannot reach %s. Check the URL is correct and the server is running.", apiURL))
			return
		}
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			sendErr("connect", fmt.Sprintf(
				"API server at %s returned status %d. Try again in a moment.", apiURL, resp.StatusCode))
			return
		}

		// ── Step: register ───────────────────────────────────────────────────
		send("register", "Registering device…")
		hostname, _ := os.Hostname()
		agentToken, employeeID, orgID, regErr := agentsync.Register(
			apiURL, token, hostname, runtime.GOOS, runtime.GOARCH,
		)
		if regErr != nil {
			sendErr("register",
				"Invite token is invalid or already used. Generate a new one in the dashboard.")
			return
		}

		// ── Step: creds ──────────────────────────────────────────────────────
		send("creds", "Saving credentials…")
		if err := keychain.SaveToken(agentToken); err != nil {
			sendErr("creds",
				"Cannot save credentials to keychain. Check System Preferences → Privacy → Keychain.")
			return
		}
		if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID, apiURL); err != nil {
			sendErr("creds",
				"Could not save identity. Check disk space and permissions in the data directory.")
			return
		}

		// ── Step: install ────────────────────────────────────────────────────
		send("install", "Installing agent…")
		progressCh := make(chan string, 16)
		go func() {
			for msg := range progressCh {
				send("install", msg)
			}
		}()

		result, installErr := selfinstall.Install(selfinstall.Config{
			BinaryData: agentBinary,
			APIURL:     apiURL,
			DataDir:    cfg.DataDir,
		}, progressCh)
		close(progressCh)

		if installErr != nil {
			msg := installErr.Error()
			switch {
			case containsAny(msg, "quarantine", "xattr"):
				sendErr("install",
					"Could not remove macOS security flag. Right-click the app and choose Open, then try again.")
			case containsAny(msg, "MDM_BLOCKED", "MDM-125"):
				sendErr("install",
					"Your organisation's IT policy is blocking background agents. Contact your IT admin and share error code: MDM-125.")
			case containsAny(msg, "registry Run key"):
				sendErr("install",
					"Could not configure auto-start. Run the setup as Administrator or contact IT.")
			case containsAny(msg, "health check"):
				sendErr("verify",
					"Agent did not start within 15 seconds. Check agent_error.log in the data directory for details.")
			default:
				sendErr("install", "Installation failed: "+msg)
			}
			return
		}

		// Emit any non-fatal warnings (e.g. MDM fallback).
		for _, w := range result.Warnings {
			send("install", "⚠ "+w)
		}

		// ── Step: done ───────────────────────────────────────────────────────
		send("done", fmt.Sprintf(
			"Agent is running! Auto-start mode: %s. This window will close in 4 seconds.",
			result.AutoStartMode))

		go func() {
			time.Sleep(200 * time.Millisecond)
			done <- struct{}{}
		}()
	})

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	openBrowser(fmt.Sprintf("http://127.0.0.1:%d", port))
	<-done
	_ = srv.Close()
}

// handleInstallService is called when the binary is re-launched elevated
// (Windows UAC path). It reads the handoff file, installs the Windows Service,
// and exits. Called ONLY on Windows; no-op on other platforms (dead code
// eliminated by compiler because handleInstallService is OS-gated by os.Args check).
func handleInstallService(handoffPath string) {
	installServiceFromHandoff(handoffPath)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, status string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
```

Note: `openBrowser` uses `exec.Command` which requires `"os/exec"` import; `containsAny` uses `strings.Contains` requiring `"strings"` import. Add both to the import block:

```go
import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/selfinstall"
	agentsync "github.com/timechamp/agent/internal/sync"
)
```

- [ ] **Step 2: Add `installServiceFromHandoff` in a Windows-only file**

The `handleInstallService` call needs a platform-specific implementation. Create `apps/agent/cmd/setup/install_service_windows.go`:

```go
//go:build windows

package main

import (
	"log"

	"github.com/timechamp/agent/internal/selfinstall"
)

// installServiceFromHandoff reads the elevated-process handoff file and
// installs the Windows Service. Called by main() when --install-service flag
// is present (UAC re-exec path). Exits with code 0 on success, 1 on failure.
func installServiceFromHandoff(handoffPath string) {
	binaryPath, err := selfinstall.ReadHandoff(handoffPath)
	if err != nil {
		log.Printf("install-service: read handoff: %v", err)
		return
	}
	if err := selfinstall.DoInstallService(binaryPath); err != nil {
		log.Printf("install-service: %v", err)
	}
}
```

This requires exporting `ReadHandoff` and `DoInstallService` from the selfinstall package. Add these exported wrappers to `selfinstall_windows.go`:

```go
// ReadHandoff is exported for use by the elevated re-exec in cmd/setup.
func ReadHandoff(path string) (string, error) { return readHandoff(path) }

// DoInstallService is exported for use by the elevated re-exec in cmd/setup.
func DoInstallService(binaryPath string) error { return doInstallService(binaryPath) }
```

For non-Windows builds, add `apps/agent/cmd/setup/install_service_other.go`:

```go
//go:build !windows

package main

// installServiceFromHandoff is a no-op on non-Windows platforms.
// The --install-service flag is only passed on Windows (UAC re-exec path).
func installServiceFromHandoff(handoffPath string) {}
```

- [ ] **Step 3: Build to verify no compile errors**

```bash
cd apps/agent
go build ./cmd/setup/...
```

Expected: no output.

- [ ] **Step 4: Also cross-compile for darwin to catch import issues**

```bash
cd apps/agent
GOOS=darwin go build ./cmd/setup/...
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/agent/cmd/setup/main.go apps/agent/cmd/setup/install_service_windows.go apps/agent/cmd/setup/install_service_other.go apps/agent/internal/selfinstall/selfinstall_windows.go
git commit -m "feat(setup): replace /register with SSE /register-stream; integrate selfinstall.Install(); add Windows --install-service UAC re-exec handler"
```

---

## Task 7: `cmd/setup/ui/index.html` — SSE-driven live step UI

**Files:**
- Modify: `apps/agent/cmd/setup/ui/index.html`

Context: The current UI does a `fetch('/register', {method:'POST'})` and shows a spinner. Replace with `EventSource('/register-stream?...')` that lights up 6 named steps in real time. On failure, show the specific error message for the failed step. On success, auto-close after 4 seconds.

- [ ] **Step 1: Replace `ui/index.html` with the SSE-driven version**

Write `apps/agent/cmd/setup/ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TimeChamp Agent Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f172a; color: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #1e293b; border: 1px solid #334155;
      border-radius: 12px; padding: 2rem; width: 460px;
      box-shadow: 0 25px 50px rgba(0,0,0,0.5);
    }
    .logo { display: flex; align-items: center; gap: 12px; margin-bottom: 1.5rem; }
    .logo-icon {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .logo h1 { font-size: 1.1rem; font-weight: 700; color: #f1f5f9; }
    .logo p  { font-size: 0.78rem; color: #64748b; margin-top: 2px; }
    hr { border: none; border-top: 1px solid #334155; margin: 1.2rem 0; }
    .field { margin-bottom: 1rem; }
    label { display: block; font-size: 0.8rem; font-weight: 500; color: #94a3b8; margin-bottom: 0.4rem; }
    input {
      width: 100%; padding: 0.6rem 0.85rem;
      background: #0f172a; border: 1px solid #334155;
      border-radius: 6px; color: #e2e8f0; font-size: 0.875rem;
      transition: border-color 0.15s;
    }
    input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
    input:disabled { opacity: 0.5; }
    .hint { font-size: 0.72rem; color: #475569; margin-top: 0.35rem; }
    .btn {
      width: 100%; padding: 0.72rem;
      background: #3b82f6; color: white;
      border: none; border-radius: 6px;
      font-size: 0.9rem; font-weight: 600; cursor: pointer;
      margin-top: 0.5rem; transition: background 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .btn:hover:not(:disabled) { background: #2563eb; }
    .btn:disabled { background: #1e40af; cursor: not-allowed; opacity: 0.8; }
    .spinner {
      width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white; border-radius: 50%;
      animation: spin 0.7s linear infinite; display: none;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Live step list ────────────────────────────────────────────────────── */
    .step-list { display: none; margin-top: 1.2rem; }
    .step-list.visible { display: block; }
    .step-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 0.45rem 0; font-size: 0.82rem; color: #64748b;
      border-bottom: 1px solid #1e293b; transition: color 0.2s;
    }
    .step-item:last-child { border-bottom: none; }
    .step-icon { flex-shrink: 0; width: 18px; text-align: center; font-size: 0.85rem; }
    .step-text { flex: 1; }
    .step-detail { font-size: 0.72rem; color: #475569; margin-top: 2px; }
    .step-item.active  { color: #93c5fd; }
    .step-item.done    { color: #86efac; }
    .step-item.failed  { color: #fca5a5; }
    .step-item.warn    { color: #fde68a; }

    .status {
      margin-top: 1rem; padding: 0.75rem 1rem;
      border-radius: 6px; font-size: 0.82rem; display: none; line-height: 1.5;
    }
    .status.error   { background: #450a0a; border: 1px solid #7f1d1d; color: #fca5a5; }
    .status.success { background: #052e16; border: 1px solid #14532d; color: #86efac; }
  </style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">⏱</div>
    <div>
      <h1>TimeChamp Agent Setup</h1>
      <p>Register this device with your organisation</p>
    </div>
  </div>

  <hr>

  <div class="field">
    <label for="apiUrl">API URL</label>
    <input id="apiUrl" type="url" value="https://api.timechamp.io/api/v1" autocomplete="off" />
    <div class="hint">Leave as default unless you are self-hosting</div>
  </div>

  <div class="field">
    <label for="token">Invite Token</label>
    <input id="token" type="password" placeholder="Paste your invite token here" autocomplete="off" />
    <div class="hint">Dashboard → Settings → Agent Setup → Generate Token</div>
  </div>

  <button class="btn" id="btn" onclick="startSetup()">
    <div class="spinner" id="spinner"></div>
    <span id="btnText">Register &amp; Start Agent</span>
  </button>

  <!-- Live step list — shown once registration begins -->
  <div class="step-list" id="stepList">
    <div class="step-item" id="step-connect">
      <span class="step-icon">○</span>
      <div class="step-text">Checking connection<div class="step-detail" id="detail-connect"></div></div>
    </div>
    <div class="step-item" id="step-register">
      <span class="step-icon">○</span>
      <div class="step-text">Registering device<div class="step-detail" id="detail-register"></div></div>
    </div>
    <div class="step-item" id="step-creds">
      <span class="step-icon">○</span>
      <div class="step-text">Saving credentials<div class="step-detail" id="detail-creds"></div></div>
    </div>
    <div class="step-item" id="step-install">
      <span class="step-icon">○</span>
      <div class="step-text">Installing agent<div class="step-detail" id="detail-install"></div></div>
    </div>
    <div class="step-item" id="step-verify">
      <span class="step-icon">○</span>
      <div class="step-text">Verifying health<div class="step-detail" id="detail-verify"></div></div>
    </div>
    <div class="step-item" id="step-done">
      <span class="step-icon">○</span>
      <div class="step-text">Done<div class="step-detail" id="detail-done"></div></div>
    </div>
  </div>

  <div id="status" class="status"></div>
</div>

<script>
  const STEPS = ['connect','register','creds','install','verify','done'];

  function setStepActive(step) {
    const el = document.getElementById('step-' + step);
    if (!el) return;
    el.className = 'step-item active';
    el.querySelector('.step-icon').textContent = '◌';
  }

  function setStepDone(step, detail) {
    const el = document.getElementById('step-' + step);
    if (!el) return;
    el.className = 'step-item done';
    el.querySelector('.step-icon').textContent = '✓';
    if (detail) document.getElementById('detail-' + step).textContent = detail;
  }

  function setStepFailed(step, errMsg) {
    const el = document.getElementById('step-' + step);
    if (!el) return;
    el.className = 'step-item failed';
    el.querySelector('.step-icon').textContent = '✗';
    document.getElementById('detail-' + step).textContent = errMsg;
  }

  function setStepWarn(step, msg) {
    const el = document.getElementById('step-' + step);
    if (!el) return;
    el.className = 'step-item warn';
    el.querySelector('.step-icon').textContent = '⚠';
    document.getElementById('detail-' + step).textContent = msg;
  }

  function showStatus(type, msg) {
    const el = document.getElementById('status');
    el.className = 'status' + (type ? ' ' + type : '');
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  }

  let currentStep = null;

  function handleEvent(data) {
    const step = data.step;
    const msg  = data.msg;
    const err  = data.error;

    if (err) {
      // Mark the failed step and all remaining as pending (dim).
      setStepFailed(step, err);
      showStatus('error', err);
      resetBtn();
      return;
    }

    if (step === 'done') {
      // Mark all preceding steps done, then mark done.
      STEPS.forEach(s => {
        if (s !== 'done') setStepDone(s);
      });
      setStepDone('done', msg);
      showStatus('success', '✓ ' + msg);
      setTimeout(() => window.close(), 4000);
      return;
    }

    // A progress message for a step that was already active (sub-step detail).
    if (step === currentStep) {
      document.getElementById('detail-' + step).textContent = msg;
      return;
    }

    // Advancing to a new step: mark previous step done (no detail), activate new.
    if (currentStep) setStepDone(currentStep);
    currentStep = step;
    setStepActive(step);
    document.getElementById('detail-' + step).textContent = msg;
  }

  function startSetup() {
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const token  = document.getElementById('token').value.trim();
    if (!token) { showStatus('error', 'Please paste your invite token.'); return; }

    // Lock UI.
    document.getElementById('btn').disabled = true;
    document.getElementById('spinner').style.display = 'block';
    document.getElementById('btnText').textContent = 'Setting up…';
    document.getElementById('apiUrl').disabled = true;
    document.getElementById('token').disabled = true;
    document.getElementById('stepList').className = 'step-list visible';
    showStatus('', '');
    currentStep = null;

    const url = '/register-stream?apiUrl=' + encodeURIComponent(apiUrl)
              + '&token='  + encodeURIComponent(token);

    const es = new EventSource(url);

    es.onmessage = function(e) {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      handleEvent(data);
      if (data.error || data.step === 'done') {
        es.close();
      }
    };

    es.onerror = function() {
      es.close();
      showStatus('error', 'Connection to setup server lost. Close and re-run the setup.');
      resetBtn();
    };
  }

  function resetBtn() {
    document.getElementById('btn').disabled = false;
    document.getElementById('spinner').style.display = 'none';
    document.getElementById('btnText').textContent = 'Register & Start Agent';
    document.getElementById('apiUrl').disabled = false;
    document.getElementById('token').disabled = false;
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Build to verify the embed compiles cleanly**

```bash
cd apps/agent
go build ./cmd/setup/...
```

Expected: no output.

- [ ] **Step 3: Smoke-test the UI manually (optional but recommended)**

Run the setup binary in a shell:
```bash
cd apps/agent
go run ./cmd/setup/
```
Expected: browser opens to the setup page showing the step list (all steps in pending `○` state). The form fields and button should be visible. Do NOT submit without a real server — just verify the page renders.

- [ ] **Step 4: Commit**

```bash
git add apps/agent/cmd/setup/ui/index.html
git commit -m "feat(setup/ui): SSE-driven 6-step live progress UI with per-step actionable error messages"
```

---

## Task 8: Final build verification and smoke test

**Files:** No changes — build and test only.

- [ ] **Step 1: Run all selfinstall tests**

```bash
cd apps/agent
go test ./internal/selfinstall/... -v
```

Expected: all platform-appropriate tests pass (darwin tests are skipped on Windows — that is correct behaviour, not a failure).

- [ ] **Step 2: Run all agent package tests**

```bash
cd apps/agent
go test ./... 2>&1 | tail -20
```

Expected: `ok github.com/timechamp/agent/internal/selfinstall` and all other packages pass or are skipped with `[no test files]`.

- [ ] **Step 3: Windows build (native — runs on the dev machine)**

```bash
cd apps/agent
go build ./cmd/setup/... ./internal/selfinstall/...
```

Expected: no output.

- [ ] **Step 4: macOS cross-compile**

```bash
cd apps/agent
GOOS=darwin GOARCH=arm64 go build ./cmd/setup/... ./internal/selfinstall/... ./internal/service/...
```

Expected: no output.

- [ ] **Step 5: Linux cross-compile**

```bash
cd apps/agent
GOOS=linux GOARCH=amd64 go build ./cmd/setup/... ./internal/selfinstall/... ./internal/service/...
```

Expected: no output.

- [ ] **Step 6: `go vet` clean**

```bash
cd apps/agent
go vet ./...
```

Expected: no output.

- [ ] **Step 7: Commit final verification note**

```bash
git commit --allow-empty -m "chore(selfinstall): all cross-platform builds and tests green"
```

---

## Error Message Reference (for UI and SSE handler)

| Failure condition | Message shown to user |
|---|---|
| API unreachable | `Cannot reach <url>. Check the URL is correct and the server is running.` |
| Invalid invite token | `Invite token is invalid or already used. Generate a new one in the dashboard.` |
| Keychain write fails | `Cannot save credentials to keychain. Check System Preferences → Privacy → Keychain.` |
| Quarantine strip fails | `Could not remove macOS security flag. Right-click the app and choose Open, then try again.` |
| MDM blocked (macOS) | `Your organisation's IT policy is blocking background agents. Contact your IT admin and share error code: MDM-125.` |
| Health check timeout | `Agent did not start within 15 seconds. Check agent_error.log in the data directory for details.` |
| Registry write fails (Windows) | `Could not configure auto-start. Run the setup as Administrator or contact IT.` |

---

## Constants Reference

| Constant | Value | Location |
|---|---|---|
| Health poll interval | 500 ms | `selfinstall.go:waitForHealth` |
| Health poll timeout | 15 s | `selfinstall.go:Install` |
| AV retry count | 3× | `selfinstall_windows.go:platformInstallBinary` |
| AV retry interval | 500 ms | `selfinstall_windows.go:platformInstallBinary` |
| Service install timeout | 10 s (20 × 500 ms) | `selfinstall_windows.go:installService` |
| ThrottleInterval | 10 s | plist template in `selfinstall_darwin.go` |
| ExitTimeout | 10 s | plist template in `selfinstall_darwin.go` |
| Success auto-close | 4 s | `ui/index.html` |
