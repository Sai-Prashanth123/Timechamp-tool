//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const (
	// Per-user Windows startup registry path. Writes here do NOT require UAC
	// elevation (it's the current user's own registry hive). Every consumer
	// Windows app — Slack, Discord, Spotify, Zoom — uses this exact key for
	// "launch on login" behavior.
	autoStartKey   = `Software\Microsoft\Windows\CurrentVersion\Run`
	autoStartValue = "TimeChamp"
)

// ensureAutoStart writes the current executable's absolute path into
// HKCU\Software\Microsoft\Windows\CurrentVersion\Run so the tray auto-launches
// at every user login.
//
// Idempotent — if the value is already set to the same path, this is a no-op
// (and logs nothing). If the user has manually removed it via Task Manager →
// Startup tab, this restores the entry on the next launch — which is mostly
// the right behavior because the only reason the tray would launch in that
// state is if the user explicitly opened it. To opt OUT of this restoration,
// remove the value AND don't open the tray again until the next install.
//
// Per-user only (no UAC required). Safe to call before the single-instance
// mutex check — it's a tiny synchronous registry write that completes in
// well under a millisecond on modern Windows.
//
// Failures are logged at WARN level but never cause the tray to exit. The
// auto-start feature is a convenience, not a correctness requirement.
func ensureAutoStart() {
	exe, err := os.Executable()
	if err != nil {
		log.Printf("[autostart] could not resolve executable path: %v", err)
		return
	}
	abs, err := filepath.Abs(exe)
	if err != nil {
		log.Printf("[autostart] could not absolutize executable path: %v", err)
		return
	}

	// Quote the path so spaces in "Program Files" or "AppData\Local\Programs"
	// don't break the command-line. Windows Run-key entries are parsed with
	// CommandLineToArgvW which respects quoted arguments.
	cmd := `"` + abs + `"`

	k, _, err := registry.CreateKey(
		registry.CURRENT_USER,
		autoStartKey,
		registry.SET_VALUE|registry.QUERY_VALUE,
	)
	if err != nil {
		log.Printf("[autostart] open Run key failed: %v", err)
		return
	}
	defer k.Close()

	// Idempotency: if the existing value matches what we'd write, skip the
	// write entirely. Avoids spurious "registered" log lines on every launch
	// after the first.
	existing, _, _ := k.GetStringValue(autoStartValue)
	if existing == cmd {
		return
	}

	if err := k.SetStringValue(autoStartValue, cmd); err != nil {
		log.Printf("[autostart] write Run key failed: %v", err)
		return
	}
	log.Printf("[autostart] registered tray for auto-start: %s", cmd)
}
