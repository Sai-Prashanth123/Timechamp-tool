//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	agentsync "github.com/timechamp/agent/internal/sync"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App holds the Wails application state.
type App struct {
	ctx         context.Context
	agentBinary []byte
}

// NewApp creates a new App instance.
func NewApp(binary []byte) *App {
	return &App{agentBinary: binary}
}

// startup is called by Wails when the app starts.
// If a token already exists (returning user), auto-launch the agent.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go a.autoLaunchIfRegistered()
	go a.monitorAgent()
}

// autoLaunchIfRegistered starts the embedded agent if the device is already
// registered and the agent is not currently running.
func (a *App) autoLaunchIfRegistered() {
	token, err := keychain.LoadToken()
	if err != nil || token == "" {
		return // not registered yet
	}

	cfg := config.Load()
	if a.isAgentRunning(cfg.DataDir) {
		return // already running
	}

	agentPath, err := a.extractAgent(cfg.DataDir)
	if err != nil {
		return
	}

	apiURL := cfg.APIURL
	cmd := exec.Command(agentPath)
	cmd.Env = append(os.Environ(),
		"TC_API_URL="+apiURL,
		"TC_AGENT_TOKEN="+token,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}

	logPath := filepath.Join(cfg.DataDir, "agent.log")
	if logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600); err == nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		defer logFile.Close()
	}

	_ = cmd.Start()
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
func (a *App) Register(apiURL, inviteToken string) error {
	hostname, _ := os.Hostname()
	agentToken, employeeID, orgID, err := agentsync.Register(
		apiURL, inviteToken, hostname, runtime.GOOS, runtime.GOARCH,
	)
	if err != nil {
		return fmt.Errorf("registration failed: %w", err)
	}

	if err := keychain.SaveToken(agentToken); err != nil {
		return fmt.Errorf("save token: %w", err)
	}

	cfg := config.Load()
	if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID); err != nil {
		return fmt.Errorf("save identity: %w", err)
	}

	agentPath, err := a.extractAgent(cfg.DataDir)
	if err != nil {
		return fmt.Errorf("extract agent: %w", err)
	}

	// Pipe agent output to a log file for debugging.
	logPath := filepath.Join(cfg.DataDir, "agent.log")
	logFile, _ := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)

	cmd := exec.Command(agentPath)
	cmd.Env = append(os.Environ(),
		"TC_API_URL="+apiURL,
		"TC_AGENT_TOKEN="+agentToken,
	)
	// Detach from parent console so the agent doesn't receive Ctrl+C signals
	// from terminal sessions that launched the tray.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	if logFile != nil {
		cmd.Stdout = logFile
		cmd.Stderr = logFile
	}
	if err := cmd.Start(); err != nil {
		if logFile != nil {
			logFile.Close()
		}
		return fmt.Errorf("launch agent: %w", err)
	}
	// Close our handle to the log file; the child process keeps its own handle.
	if logFile != nil {
		logFile.Close()
	}
	return nil
}

// GetStatus returns whether the background agent process is running.
func (a *App) GetStatus() map[string]interface{} {
	cfg := config.Load()
	running := a.isAgentRunning(cfg.DataDir)
	return map[string]interface{}{"running": running}
}

// isAgentRunning checks liveness via the health HTTP endpoint, falling back to
// the PID file + Windows OpenProcess check to cover the startup race window.
func (a *App) isAgentRunning(dataDir string) bool {
	// Primary check: HTTP health endpoint (cannot lie — if it responds, agent is alive)
	client := &http.Client{Timeout: 1 * time.Second}
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

// monitorAgent runs forever, restarting the agent if it exits unexpectedly.
func (a *App) monitorAgent() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		token, err := keychain.LoadToken()
		if err != nil || token == "" {
			continue // not registered yet
		}
		cfg := config.Load()
		if a.isAgentRunning(cfg.DataDir) {
			continue // already running fine
		}
		// Registered but agent is not running — restart it.
		a.autoLaunchIfRegistered()
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
