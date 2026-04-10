//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"github.com/energye/systray"
	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/sleepwatch"
	agentsync "github.com/timechamp/agent/internal/sync"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App holds the Wails application state.
type App struct {
	ctx         context.Context
	agentBinary []byte
	sleepWatcher *sleepwatch.Watcher // detects system resume events
	wakeSignal   chan struct{}        // buffered(1) — signals monitorAgent to wake early
}

// NewApp creates a new App instance.
func NewApp(binary []byte) *App {
	return &App{agentBinary: binary}
}

// startup is called by Wails when the app starts.
// If a token already exists (returning user), auto-launch the agent.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.wakeSignal = make(chan struct{}, 1)
	a.sleepWatcher = sleepwatch.New()
	a.sleepWatcher.Start()
	go a.handlePowerEvents()
	go a.autoLaunchIfRegistered()
	go a.monitorAgent()
}

// autoLaunchIfRegistered starts the embedded agent if the device is already
// registered and the agent is not currently running.
// The agent token is NOT passed via environment — it reads from the OS keychain
// directly (already persisted by Register). Env vars are visible in Task Manager.
func (a *App) autoLaunchIfRegistered() {
	token, err := keychain.LoadToken()
	if err != nil || token == "" {
		return // not registered yet
	}

	cfg := config.Load()
	if a.isAgentRunning(cfg.DataDir) {
		return // already running
	}

	// Prefer the API URL saved in identity.json (written during Register) over
	// the tray's own config default, which falls back to the production URL.
	apiURL := cfg.APIURL
	if identity, err := config.LoadIdentity(cfg.DataDir); err == nil && identity.APIURL != "" {
		apiURL = identity.APIURL
	}

	agentPath, err := a.extractAgent(cfg.DataDir)
	if err != nil {
		return
	}

	cmd := exec.Command(agentPath)
	// Only pass TC_API_URL — agent reads auth token from OS keychain.
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	// Agent manages its own rotating log file in DataDir — no stdout redirect needed.
	if err := cmd.Start(); err != nil {
		log.Printf("autoLaunch: failed to start agent: %v", err)
	}
}

// CheckSetup returns true if the agent is already registered (token in OS keychain).
func (a *App) CheckSetup() bool {
	token, err := keychain.LoadToken()
	return err == nil && token != ""
}

// Ping verifies that the given API URL is reachable. Returns nil on success.
func (a *App) Ping(apiURL string) error {
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(apiURL + "/health")
	if err != nil {
		return fmt.Errorf("cannot reach API: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 500 {
		return fmt.Errorf("API returned status %d", resp.StatusCode)
	}
	return nil
}

// Register authenticates with the API using the invite token, saves credentials,
// extracts the embedded agent binary to the data directory, and launches it.
// Token is saved to keychain BEFORE launch; the agent reads it from keychain
// directly and no secret is passed via environment variable.
func (a *App) Register(apiURL, inviteToken string) error {
	hostname, _ := os.Hostname()
	agentToken, employeeID, orgID, err := agentsync.Register(
		apiURL, inviteToken, hostname, runtime.GOOS, runtime.GOARCH,
	)
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}

	// Save token to OS keychain BEFORE launching agent so agent can read it.
	if err := keychain.SaveToken(agentToken); err != nil {
		return fmt.Errorf("save token: %w", err)
	}

	cfg := config.Load()
	if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID, apiURL); err != nil {
		return fmt.Errorf("save identity: %w", err)
	}

	agentPath, err := a.extractAgent(cfg.DataDir)
	if err != nil {
		return fmt.Errorf("extract agent: %w", err)
	}

	cmd := exec.Command(agentPath)
	// Only pass TC_API_URL — agent reads auth token from OS keychain.
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	// Detach from parent console so the agent doesn't receive Ctrl+C signals.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	// Agent manages its own rotating log file in DataDir — no stdout redirect needed.
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch agent: %w", err)
	}
	return nil
}

// GetStatus returns whether the background agent process is running.
func (a *App) GetStatus() map[string]any {
	cfg := config.Load()
	running := a.isAgentRunning(cfg.DataDir)
	return map[string]any{"running": running}
}

// isAgentRunning checks liveness via the health HTTP endpoint, falling back to
// the PID file + Windows OpenProcess check to cover the startup race window.
func (a *App) isAgentRunning(dataDir string) bool {
	// Primary check: HTTP health endpoint (cannot lie — if it responds, agent is alive)
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:27183/health")
	if err == nil {
		resp.Body.Close()
		return resp.StatusCode == 200
	}

	// Fallback: PID file + Windows OpenProcess (covers startup race)
	pidFile := filepath.Join(dataDir, "agent.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return false
	}
	var pid int
	if err := json.Unmarshal(data, &pid); err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
		kernel32 := syscall.NewLazyDLL("kernel32.dll")
		handle, _, _ := kernel32.NewProc("OpenProcess").Call(
			PROCESS_QUERY_LIMITED_INFORMATION, 0, uintptr(pid))
		if handle == 0 {
			return false
		}
		var exitCode uint32
		kernel32.NewProc("GetExitCodeProcess").Call(handle, uintptr(unsafe.Pointer(&exitCode)))
		kernel32.NewProc("CloseHandle").Call(handle)
		return exitCode == 259 // STILL_ACTIVE
	}
	proc, err := os.FindProcess(pid)
	if err != nil || proc == nil {
		return false
	}
	return proc.Signal(os.Signal(nil)) == nil
}

// handlePowerEvents listens for wall-clock-drift resume events and triggers
// an immediate agent restart check, bypassing the monitorAgent backoff timer.
func (a *App) handlePowerEvents() {
	for event := range a.sleepWatcher.C {
		if event.Type == sleepwatch.Resume {
			log.Printf("[tray] system resumed after %v — checking agent",
				event.Duration.Round(time.Second))
			// Unblock monitorAgent immediately (non-blocking send).
			select {
			case a.wakeSignal <- struct{}{}:
			default:
			}
			go a.restartAgentIfNeeded()
		}
	}
}

// monitorAgent runs forever, restarting the agent if it exits unexpectedly.
// Uses exponential backoff (10s → 5m) to avoid thrashing on repeated failures.
// The wakeSignal channel allows resume events to interrupt the backoff wait.
func (a *App) monitorAgent() {
	const (
		minBackoff = 10 * time.Second
		maxBackoff = 5 * time.Minute
	)
	backoff := minBackoff
	timer := time.NewTimer(backoff)
	defer timer.Stop()

	for {
		select {
		case <-timer.C:
			// Normal poll interval elapsed.
		case <-a.wakeSignal:
			// Wake signal from sleepwatch — check immediately.
			// Stop and drain the timer to prevent a spurious double-fire.
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			backoff = minBackoff
		}

		token, err := keychain.LoadToken()
		if err != nil || token == "" {
			backoff = minBackoff
			timer.Reset(backoff)
			continue
		}

		cfg := config.Load()
		if a.isAgentRunning(cfg.DataDir) {
			backoff = minBackoff
			timer.Reset(backoff)
			continue
		}

		// Agent not running — restart with backoff.
		a.autoLaunchIfRegistered()
		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
		timer.Reset(backoff)
	}
}

// restartAgentIfNeeded is called immediately on resume. It checks the agent
// health endpoint (3s timeout); if unhealthy, kills the stale process and
// relaunches. This provides ≤10s recovery instead of the full backoff delay.
func (a *App) restartAgentIfNeeded() {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get("http://127.0.0.1:27183/health")
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode == 200 {
			return // agent is alive and healthy
		}
	}
	if resp != nil {
		resp.Body.Close()
	}

	cfg := config.Load()
	a.stopAgentByPID(cfg.DataDir)
	a.autoLaunchIfRegistered()
}

// stopAgentByPID sends SIGTERM to the agent PID from the PID file, waits up
// to 3 seconds for a clean exit, then sends SIGKILL if it is still alive.
func (a *App) stopAgentByPID(dataDir string) {
	pidFile := filepath.Join(dataDir, "agent.pid")
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return
	}
	var pid int
	if err := json.Unmarshal(data, &pid); err != nil {
		return
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}

	_ = proc.Signal(syscall.SIGTERM)

	done := make(chan struct{})
	go func() {
		defer close(done)
		proc.Wait() //nolint:errcheck
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = proc.Kill()
	}
}

// extractAgent writes the embedded agent binary to dataDir and returns its path.
func (a *App) extractAgent(dataDir string) (string, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", err
	}
	name := "timechamp-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(dataDir, name)
	if err := os.WriteFile(dest, a.agentBinary, 0755); err != nil {
		return "", err
	}
	return dest, nil
}

// ── System tray ──────────────────────────────────────────────────────────────

func (a *App) onTrayReady() {
	systray.SetTitle("TimeChamp")
	systray.SetTooltip("TimeChamp Agent")

	mShow := systray.AddMenuItem("Show", "Show TimeChamp window")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Quit", "Quit TimeChamp")

	mShow.Click(func() {
		wailsruntime.WindowShow(a.ctx)
	})
	mQuit.Click(func() {
		systray.Quit()
		os.Exit(0)
	})
}

func (a *App) onTrayExit() {}
