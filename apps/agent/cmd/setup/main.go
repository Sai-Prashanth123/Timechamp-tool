// Package main is the TimeChamp Agent GUI setup wizard.
// The agent binary is embedded at compile time — one file, no separate download needed.
package main

import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/ncruces/zenity"

	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	agentsync "github.com/timechamp/agent/internal/sync"
)

// agentBinary is the agent executable embedded at compile time by CI.
// The CI builds the agent first, copies it to cmd/setup/agent_bin, then builds setup.
//
//go:embed agent_bin
var agentBinary []byte

func main() {
	cfg := config.Load()

	// ── Step 1: API URL ───────────────────────────────────────────────────────
	apiURL, err := zenity.Entry(
		"Enter your API URL (leave blank for default):",
		zenity.Title("TimeChamp Agent Setup — Step 1 of 2"),
		zenity.EntryText(cfg.APIURL),
		zenity.Width(480),
	)
	if err != nil {
		os.Exit(0)
	}
	apiURL = strings.TrimSpace(apiURL)
	if apiURL == "" {
		apiURL = cfg.APIURL
	}

	// ── Step 2: Invite Token ──────────────────────────────────────────────────
	_, token, err := zenity.Password(
		zenity.Title("TimeChamp Agent Setup — Step 2 of 2"),
		zenity.Attach(0),
	)
	if err != nil {
		os.Exit(0)
	}
	token = strings.TrimSpace(token)
	if token == "" {
		_ = zenity.Error("Invite token cannot be empty.", zenity.Title("TimeChamp Setup"))
		os.Exit(1)
	}

	// ── Progress ──────────────────────────────────────────────────────────────
	progress, _ := zenity.Progress(
		zenity.Title("TimeChamp Agent Setup"),
		zenity.Width(420),
		zenity.MaxValue(100),
	)
	if progress != nil {
		_ = progress.Text("Registering device with server…")
		_ = progress.Value(20)
	}

	// ── Register ──────────────────────────────────────────────────────────────
	hostname, _ := os.Hostname()
	agentToken, employeeID, orgID, regErr := agentsync.Register(
		apiURL, token, hostname, runtime.GOOS, runtime.GOARCH,
	)
	if regErr != nil {
		if progress != nil {
			_ = progress.Close()
		}
		_ = zenity.Error(
			fmt.Sprintf("Registration failed:\n%v\n\nCheck your invite token and API URL.", regErr),
			zenity.Title("TimeChamp Setup — Error"),
		)
		os.Exit(1)
	}

	if progress != nil {
		_ = progress.Text("Saving credentials…")
		_ = progress.Value(50)
	}

	if err := keychain.SaveToken(agentToken); err != nil {
		if progress != nil {
			_ = progress.Close()
		}
		_ = zenity.Error(fmt.Sprintf("Failed to save token: %v", err), zenity.Title("TimeChamp Setup"))
		os.Exit(1)
	}
	if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID); err != nil {
		if progress != nil {
			_ = progress.Close()
		}
		_ = zenity.Error(fmt.Sprintf("Failed to save identity: %v", err), zenity.Title("TimeChamp Setup"))
		os.Exit(1)
	}

	// ── Extract agent binary ──────────────────────────────────────────────────
	if progress != nil {
		_ = progress.Text("Installing agent…")
		_ = progress.Value(75)
	}

	agentPath, extractErr := extractAgent(cfg.DataDir)
	if extractErr != nil {
		if progress != nil {
			_ = progress.Close()
		}
		_ = zenity.Error(fmt.Sprintf("Failed to install agent: %v", extractErr), zenity.Title("TimeChamp Setup"))
		os.Exit(1)
	}

	// ── Launch agent ──────────────────────────────────────────────────────────
	if progress != nil {
		_ = progress.Text("Starting agent…")
		_ = progress.Value(90)
	}

	cmd := exec.Command(agentPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	_ = cmd.Start()

	if progress != nil {
		_ = progress.Value(100)
		_ = progress.Close()
	}

	_ = zenity.Info(
		"TimeChamp Agent is installed and running in the background.\n\nThis window will now close.",
		zenity.Title("Setup Complete"),
	)
}

// extractAgent writes the embedded agent binary to DataDir and returns its path.
func extractAgent(dataDir string) (string, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", err
	}
	name := "timechamp-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(dataDir, name)
	if err := os.WriteFile(dest, agentBinary, 0755); err != nil {
		return "", err
	}
	return dest, nil
}
