//go:build linux

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
)

const systemdServiceName = "timechamp-agent"

// systemdUnitTemplate is the content of the user systemd service unit.
// Installs to ~/.config/systemd/user/timechamp-agent.service
const systemdUnitTemplate = `[Unit]
Description=Time Champ Agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart={{.BinaryPath}}
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
Environment=HOME=%h

[Install]
WantedBy=default.target
`

type linuxManager struct{}

func newManager() Manager { return &linuxManager{} }

// userHome returns the user home directory with defensive fallbacks, mirroring
// the darwin implementation. Returns /tmp as a last resort so paths are never
// relative (which would silently write files to the process working directory).
func userHome() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	// HOME may be unset in minimal environments; try common Linux paths.
	for _, candidate := range []string{"/home/" + os.Getenv("USER"), "/root"} {
		if candidate != "/home/" {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	return "/tmp"
}

// unitPath returns the path to the user systemd service unit file.
// Respects $XDG_CONFIG_HOME per the XDG Base Directory Specification.
func unitPath() string {
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		return filepath.Join(xdg, "systemd", "user", systemdServiceName+".service")
	}
	return filepath.Join(userHome(), ".config", "systemd", "user", systemdServiceName+".service")
}

// Install writes the systemd user unit and enables + starts it.
func (m *linuxManager) Install(binaryPath string) error {
	absPath, err := filepath.Abs(binaryPath)
	if err != nil {
		return err
	}

	// Capture path once to avoid repeated env lookups.
	path := unitPath()

	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("create systemd user dir: %w", err)
	}

	data := struct{ BinaryPath string }{absPath}
	tmpl, err := template.New("unit").Parse(systemdUnitTemplate)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("write unit file: %w", err)
	}
	if err := tmpl.Execute(f, data); err != nil {
		f.Close()
		return err
	}
	f.Close()

	// Reload systemd, then enable and start.
	if out, err := exec.Command("systemctl", "--user", "daemon-reload").CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl daemon-reload: %w — %s", err, out)
	}
	if out, err := exec.Command("systemctl", "--user", "enable", "--now", systemdServiceName).CombinedOutput(); err != nil {
		return fmt.Errorf("systemctl enable: %w — %s", err, out)
	}

	fmt.Printf("systemd user service installed at %s\n", path)
	return nil
}

// Uninstall stops, disables, and removes the systemd user unit.
func (m *linuxManager) Uninstall() error {
	path := unitPath()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("unit file not found: %s", path)
	}

	// Stop + disable (ignore errors — unit may already be stopped).
	_, _ = exec.Command("systemctl", "--user", "stop", systemdServiceName).CombinedOutput()
	_, _ = exec.Command("systemctl", "--user", "disable", systemdServiceName).CombinedOutput()

	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove unit file: %w", err)
	}

	_, _ = exec.Command("systemctl", "--user", "daemon-reload").CombinedOutput()
	return nil
}

// Start starts the systemd user service immediately.
func (m *linuxManager) Start() error {
	out, err := exec.Command("systemctl", "--user", "start", systemdServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl start: %w — %s", err, out)
	}
	return nil
}

// Stop stops the systemd user service.
func (m *linuxManager) Stop() error {
	out, err := exec.Command("systemctl", "--user", "stop", systemdServiceName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl stop: %w — %s", err, out)
	}
	return nil
}

// Status returns "running", "stopped", or "not installed".
func (m *linuxManager) Status() (string, error) {
	if _, err := os.Stat(unitPath()); os.IsNotExist(err) {
		return "not installed", nil
	}
	out, err := exec.Command("systemctl", "--user", "is-active", systemdServiceName).CombinedOutput()
	state := strings.TrimSpace(string(out))
	if err == nil && state == "active" {
		return "running", nil
	}
	return "stopped", nil
}

// IsWindowsService always returns false on Linux.
func IsWindowsService() bool { return false }

// RunAsService is a no-op on Linux — the process simply runs normally under
// the supervision of systemd.
func RunAsService(mainFn func()) error {
	mainFn()
	return nil
}
