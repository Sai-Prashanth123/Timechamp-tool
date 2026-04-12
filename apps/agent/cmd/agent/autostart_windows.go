//go:build windows

package main

// ensureAutoStart is a no-op on Windows when called from the AGENT process.
//
// Windows auto-start is registered by the TRAY process — see:
//   - apps/agent/cmd/tray/autostart_windows.go      (HKCU\Run key)
//   - apps/agent/cmd/tray/scheduledtask_windows.go  (Task Scheduler entry)
//
// The tray is the canonical entry point on Windows: it embeds the agent
// binary, extracts it on first launch, and supervises it via monitorAgent.
// The agent itself never needs to write any auto-start state on Windows.
//
// If a future Windows install path skips the tray (e.g. headless service
// install via setup.exe), the existing selfinstall package handles
// registration via Windows SCM (StartType=Automatic) and falls back to a
// HKCU Run entry for the agent binary on non-admin installs.
func ensureAutoStart() {}
