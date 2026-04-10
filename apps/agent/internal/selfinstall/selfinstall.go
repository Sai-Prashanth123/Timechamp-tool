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

// getHealthURL returns the agent health endpoint URL.
// Replaced in tests to point at a mock server.
// WARNING: not safe to replace concurrently; do not use t.Parallel() in tests
// that override this variable.
var getHealthURL = func() string { return "http://127.0.0.1:27183/health" }

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
		return Result{}, fmt.Errorf("health check: %w — check logs in the agent data directory for details", err)
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
		resp, err := client.Get(getHealthURL())
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
