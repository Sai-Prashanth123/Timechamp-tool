// Package service provides OS-level service installation so the agent runs
// automatically at boot without requiring a logged-in user session.
//
// Windows: registers as a Windows Service via the Service Control Manager.
// macOS:   installs a LaunchAgent plist in ~/Library/LaunchAgents (per-user)
//          or a LaunchDaemon in /Library/LaunchDaemons (system-wide, root).
package service

// Manager can install, uninstall, start, and stop the OS-level service entry.
type Manager interface {
	// Install registers the service. binaryPath is the absolute path to the
	// agent executable that should be run at boot.
	Install(binaryPath string) error
	// Uninstall removes the service registration.
	Uninstall() error
	// Start starts the service immediately (without waiting for reboot).
	Start() error
	// Stop stops the running service.
	Stop() error
	// Status returns "running", "stopped", or "not installed".
	Status() (string, error)
}

// New returns the OS-appropriate Manager.
func New() Manager {
	return newManager()
}
