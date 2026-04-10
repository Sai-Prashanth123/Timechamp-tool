//go:build darwin

package selfinstall

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

const launchAgentLabel = "com.timechamp.agent"

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

// darwinHome returns the user home directory with defensive fallbacks.
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
// first-run. Uses xattr CLI as primary and syscall as fallback.
func stripQuarantine(path string) {
	exec.Command("xattr", "-d", "com.apple.quarantine", path).Run() //nolint:errcheck
	exec.Command("xattr", "-c", path).Run()                          //nolint:errcheck
	unix.Removexattr(path, "com.apple.quarantine")                   //nolint:errcheck
}

// platformConfigureAutoStart writes the LaunchAgent plist and registers it
// with launchd using the modern launchctl bootstrap gui/UID API.
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
	// before the agent's first screenshot attempt. Non-blocking.
	requestPermissions()

	return "launchd", warnings, nil
}

// bootstrapAgent registers and starts the LaunchAgent using launchctl.
// 1. If already loaded → kickstart (handles idempotent re-install)
// 2. macOS 10.15+: launchctl bootstrap gui/UID
// 3. Detect MDM block (exit 125 / "not permitted") → direct-launch fallback
// 4. Fall back to deprecated launchctl load -w (macOS < 10.15)
func bootstrapAgent(plistPath, binaryPath string) (warnings []string, err error) {
	uid := os.Getuid()

	// Check if already loaded.
	out, _ := exec.Command("launchctl", "list", launchAgentLabel).CombinedOutput()
	if strings.Contains(string(out), launchAgentLabel) {
		exec.Command("launchctl", "kickstart", "-k", //nolint:errcheck
			fmt.Sprintf("gui/%d/%s", uid, launchAgentLabel)).Run()
		return nil, nil
	}

	// macOS 10.15+ bootstrap.
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
		// Best-effort: launch binary directly for this session only.
		cmd := exec.Command(binaryPath)
		cmd.Env = append(os.Environ())
		cmd.Start() //nolint:errcheck
		return []string{
			"MDM_BLOCKED: Your organisation's IT policy blocked background agent registration. " +
				"Contact IT and share error code MDM-125. " +
				"The agent will run until next reboot.",
		}, nil
	}

	// Fallback: deprecated launchctl load (macOS < 10.15).
	out2, loadErr := exec.Command("launchctl", "load", "-w", plistPath).CombinedOutput()
	if loadErr != nil {
		return nil, fmt.Errorf("launchctl load: %w — %s", loadErr, out2)
	}
	return nil, nil
}

// platformStartAgent is a no-op on macOS: launchctl bootstrap already started
// the agent inside platformConfigureAutoStart.
func platformStartAgent(binaryPath, apiURL string) error {
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
