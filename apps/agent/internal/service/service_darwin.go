//go:build darwin

package service

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
)

const launchAgentLabel = "com.timechamp.agent"

// launchAgentPlistTemplate is the plist for a per-user LaunchAgent.
// Installs to ~/Library/LaunchAgents/com.timechamp.agent.plist
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

type darwinManager struct{}

func newManager() Manager { return &darwinManager{} }

// userHome returns the user home directory, falling back to /tmp so we never
// return an empty path that would cause plist writes to go to the filesystem root.
func userHome() string {
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	// HOME may be unset in restricted launchd environments; try common paths.
	for _, candidate := range []string{"/Users/" + os.Getenv("USER"), "/var/root"} {
		if candidate != "/Users/" {
			if _, err := os.Stat(candidate); err == nil {
				return candidate
			}
		}
	}
	return "/tmp"
}

// plistPath returns the path to the LaunchAgent plist.
func plistPath() string {
	return filepath.Join(userHome(), "Library", "LaunchAgents", launchAgentLabel+".plist")
}

// logDir returns the directory where agent logs are written.
func logDir() string {
	return filepath.Join(userHome(), "Library", "Logs", "TimeChamp")
}

// Install writes the LaunchAgent plist and loads it with launchctl.
func (m *darwinManager) Install(binaryPath string) error {
	absPath, err := filepath.Abs(binaryPath)
	if err != nil {
		return err
	}

	ldir := logDir()
	if err := os.MkdirAll(ldir, 0755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	plistDir := filepath.Dir(plistPath())
	if err := os.MkdirAll(plistDir, 0755); err != nil {
		return fmt.Errorf("create LaunchAgents dir: %w", err)
	}

	data := struct {
		Label      string
		BinaryPath string
		LogDir     string
		Home       string
	}{launchAgentLabel, absPath, ldir, userHome()}

	tmpl, err := template.New("plist").Parse(launchAgentPlistTemplate)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(plistPath(), os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("write plist: %w", err)
	}
	if err := tmpl.Execute(f, data); err != nil {
		f.Close()
		return err
	}
	f.Close()

	uid := os.Getuid()
	guiDomain := fmt.Sprintf("gui/%d", uid)

	// Check if already loaded — kickstart to apply any binary change.
	listOut, _ := exec.Command("launchctl", "list", launchAgentLabel).CombinedOutput()
	if strings.Contains(string(listOut), launchAgentLabel) {
		ksOut, ksErr := exec.Command("launchctl", "kickstart", "-k",
			fmt.Sprintf("%s/%s", guiDomain, launchAgentLabel)).CombinedOutput()
		if ksErr != nil {
			return fmt.Errorf("launchctl kickstart: %w — %s", ksErr, ksOut)
		}
		return nil
	}

	// macOS 10.15+ bootstrap (modern API).
	out, err := exec.Command("launchctl", "bootstrap", guiDomain, plistPath()).CombinedOutput()
	if err != nil {
		// Fallback: deprecated load for macOS < 10.15.
		out2, err2 := exec.Command("launchctl", "load", "-w", plistPath()).CombinedOutput()
		if err2 != nil {
			return fmt.Errorf("launchctl bootstrap: %w (%s); load fallback: %w (%s)",
				err, out, err2, out2)
		}
	}

	fmt.Printf("LaunchAgent installed at %s\n", plistPath())
	return nil
}

// Uninstall unloads and removes the LaunchAgent plist.
func (m *darwinManager) Uninstall() error {
	path := plistPath()
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return fmt.Errorf("LaunchAgent plist not found: %s", path)
	}

	uid := os.Getuid()
	guiDomain := fmt.Sprintf("gui/%d", uid)
	out, err := exec.Command("launchctl", "bootout", guiDomain, path).CombinedOutput()
	if err != nil {
		// Fallback: deprecated unload for older macOS.
		out2, err2 := exec.Command("launchctl", "unload", "-w", path).CombinedOutput()
		if err2 != nil {
			return fmt.Errorf("launchctl bootout: %w (%s); unload fallback: %w (%s)",
				err, out, err2, out2)
		}
	}

	return os.Remove(path)
}

// Start starts the LaunchAgent immediately via launchctl bootstrap / kickstart.
func (m *darwinManager) Start() error {
	uid := os.Getuid()
	target := fmt.Sprintf("gui/%d/%s", uid, launchAgentLabel)
	out, err := exec.Command("launchctl", "kickstart", "-k", target).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl kickstart: %w — %s", err, out)
	}
	return nil
}

// Stop stops the running LaunchAgent.
func (m *darwinManager) Stop() error {
	out, err := exec.Command("launchctl", "stop", launchAgentLabel).CombinedOutput()
	if err != nil {
		return fmt.Errorf("launchctl stop: %w — %s", err, out)
	}
	return nil
}

// Status returns the current service state.
func (m *darwinManager) Status() (string, error) {
	out, err := exec.Command("launchctl", "list", launchAgentLabel).CombinedOutput()
	if err != nil {
		if strings.Contains(string(out), "Could not find service") {
			return "not installed", nil
		}
		return "not installed", nil
	}
	result := string(out)
	if strings.Contains(result, `"PID"`) {
		return "running", nil
	}
	if _, statErr := os.Stat(plistPath()); statErr == nil {
		return "stopped", nil
	}
	return "not installed", nil
}

// IsWindowsService always returns false on macOS.
func IsWindowsService() bool { return false }

// RunAsService is a no-op on macOS — the process simply runs normally under
// the supervision of launchd.
func RunAsService(mainFn func()) error {
	mainFn()
	return nil
}
