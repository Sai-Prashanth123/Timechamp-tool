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
// Rename on NTFS does NOT inherit the Zone.Identifier ADS from the temp file
// (because our process wrote the temp file, not the browser), so SmartScreen
// is bypassed cleanly.
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

	// Retry up to 3 times to handle antivirus file locks.
	var writeErr error
	for range 3 {
		writeErr = os.WriteFile(tmp, cfg.BinaryData, 0755)
		if writeErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if writeErr != nil {
		os.Remove(tmp) //nolint:errcheck — best-effort cleanup
		return "", fmt.Errorf("write binary: %w", writeErr)
	}

	var renameErr error
	for range 3 {
		renameErr = os.Rename(tmp, dest)
		if renameErr == nil {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if renameErr != nil {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("rename binary: %w", renameErr)
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
		// Start() returns an error if already running — not fatal.
		_ = s.Start()
		return nil
	}

	// Registry mode: launch as detached child process.
	cmd := exec.Command(binaryPath)
	cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP,
	}
	// Redirect stdio so the background agent does not inherit the installer's
	// console handles, which would keep them open and block handle closure.
	cmd.Stdin = nil
	devNull, err := os.Open(os.DevNull)
	if err == nil {
		cmd.Stdout = devNull
		cmd.Stderr = devNull
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

// readHandoff reads the handoff file written by writeHandoff, deletes it, and
// returns the binaryPath.
func readHandoff(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	os.Remove(path) //nolint:errcheck — best effort cleanup
	var p handoffPayload
	if err := json.Unmarshal(data, &p); err != nil {
		return "", err
	}
	return p.BinaryPath, nil
}

// ReadHandoff is exported for the elevated re-exec in cmd/setup.
func ReadHandoff(path string) (string, error) { return readHandoff(path) }

// DoInstallService is exported for the elevated re-exec in cmd/setup.
func DoInstallService(binaryPath string) error { return doInstallService(binaryPath) }

// installService tries to install a Windows Service by re-launching self with
// admin rights via ShellExecute(runas). Returns (true, nil) if installed,
// (false, nil) if UAC was declined or timed out (caller falls back to registry).
func installService(binaryPath string) (bool, error) {
	if isAdmin() {
		return true, doInstallService(binaryPath)
	}

	handoffPath, err := writeHandoff(binaryPath)
	if err != nil {
		return false, fmt.Errorf("write handoff: %w", err)
	}

	exe, err := os.Executable()
	if err != nil {
		return false, fmt.Errorf("os.Executable: %w", err)
	}

	if err := shellExecuteRunas(exe, "--install-service "+handoffPath); err != nil {
		// UAC was declined — fall through to registry.
		os.Remove(handoffPath) //nolint:errcheck
		return false, nil
	}

	// Poll for service to appear (up to 10 s / 20 × 500 ms).
	for range 20 {
		time.Sleep(500 * time.Millisecond)
		if serviceExists() {
			return true, nil
		}
	}
	// Elevated process timed out or crashed — clean up the handoff file.
	os.Remove(handoffPath) //nolint:errcheck
	return false, nil
}

// doInstallService registers the Windows Service via SCM. Idempotent.
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
	s.Close()
	return nil
}

// shellExecuteRunas re-launches exe with admin rights via Windows ShellExecute.
// Returns error if the user declines UAC or the call fails.
func shellExecuteRunas(exe, args string) error {
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, err := syscall.UTF16PtrFromString(exe)
	if err != nil {
		return fmt.Errorf("encode exe path: %w", err)
	}
	params, _ := syscall.UTF16PtrFromString(args)
	if err = windows.ShellExecute(0, verb, file, params, nil, windows.SW_HIDE); err != nil {
		return fmt.Errorf("ShellExecute runas: %w (UAC declined or unavailable)", err)
	}
	return nil
}

// installRegistryRunKey writes the agent binary path to
// HKCU\...\Run so the agent starts at user login. Requires no elevation.
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
