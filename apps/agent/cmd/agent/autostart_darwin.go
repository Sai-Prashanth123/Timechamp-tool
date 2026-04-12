//go:build darwin

package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// launchAgentLabel is the reverse-DNS identifier macOS launchd uses to
// reference our plist. Surfaces in `launchctl list | grep timechamp`.
const launchAgentLabel = "com.timechamp.agent"

// ensureAutoStart writes a per-user macOS LaunchAgent plist to
// ~/Library/LaunchAgents/com.timechamp.agent.plist so the agent auto-starts
// on every login and is supervised by launchd. Idempotent — only writes
// when the plist content has changed.
//
// macOS launchd is the canonical user-process supervisor — it's `init` for
// per-user processes. The plist's KeepAlive flag means launchd will relaunch
// the agent within ~10 seconds of any unexpected exit, which gives us:
//
//   - Auto-start at every user login (RunAtLoad=true)
//   - Crash recovery within ~10s (KeepAlive=true)
//   - Survives sleep / wake (existing process keeps running through sleep,
//     and KeepAlive catches any death during sleep within ~10s of wake)
//   - Survives lock / unlock (same — process never died)
//
// The single LaunchAgent plist replaces BOTH of the Windows mechanisms
// (HKCU\Run + Task Scheduler) because launchd is more capable than either
// one. No second belt-and-braces path needed on macOS.
//
// Per-user — no sudo, no admin, no root. The plist lives entirely in the
// user's home directory and is loaded by launchd in the user's GUI session.
//
// Failures are logged but never abort agent startup. Auto-start is a
// convenience layer; if the file write fails the agent still runs for the
// current session.
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

	home, err := os.UserHomeDir()
	if err != nil {
		log.Printf("[autostart] could not get home directory: %v", err)
		return
	}

	plistDir := filepath.Join(home, "Library", "LaunchAgents")
	if err := os.MkdirAll(plistDir, 0755); err != nil {
		log.Printf("[autostart] mkdir LaunchAgents failed: %v", err)
		return
	}

	logsDir := filepath.Join(home, "Library", "Logs", "TimeChamp")
	// Best-effort — if Logs dir creation fails, launchd will use stdout
	// from its own log facilities and we don't lose anything critical.
	_ = os.MkdirAll(logsDir, 0755)

	plistPath := filepath.Join(plistDir, launchAgentLabel+".plist")
	plistContent := buildLaunchAgentPlist(abs, logsDir)

	// Idempotency: only write if the existing content differs. Avoids
	// spurious "registered" log lines on every launch and avoids touching
	// the file's mtime when nothing changed.
	if existing, readErr := os.ReadFile(plistPath); readErr == nil {
		if string(existing) == plistContent {
			return
		}
	}

	if err := os.WriteFile(plistPath, []byte(plistContent), 0644); err != nil {
		log.Printf("[autostart] write plist failed: %v", err)
		return
	}
	log.Printf("[autostart] registered LaunchAgent: %s", plistPath)
}

// buildLaunchAgentPlist returns the canonical plist body.
//
// Field semantics:
//   - Label: reverse-DNS identifier, must match the filename's basename
//     (without .plist) for launchctl to find it.
//   - ProgramArguments: argv array. argv[0] is the executable; we don't
//     pass any flags because the agent reads its config from the env +
//     identity.json file in DataDir.
//   - RunAtLoad=true: launches the process when launchd loads the plist
//     (= at user login, or when launchctl bootstrap runs).
//   - KeepAlive=true: relaunches automatically on any exit. Combined with
//     macOS's exponential throttling (10s minimum between relaunches),
//     this protects against crash loops while still recovering quickly.
//   - ProcessType=Interactive: tells launchd this is an interactive user
//     process — gets full Aqua session access (GUI APIs, keychain, etc.)
//     and is killed when the user logs out.
//   - StandardOutPath / StandardErrorPath: launchd captures the process's
//     stdout/stderr to these files. Useful for debugging launchd-spawned
//     instances where the agent's own rotating log might not exist yet.
//
// Wake-from-sleep is NOT a separate trigger because:
//   1. The existing process keeps running through sleep (macOS just freezes
//      the threads). The agent's sleepwatch.Watcher detects the wall-clock
//      drift on wake and resets the circuit breaker.
//   2. If the process somehow died during sleep, KeepAlive relaunches it
//      within ~10 seconds of wake.
//
// Lock/unlock similarly is invisible to launchd — the process keeps running.
func buildLaunchAgentPlist(exePath, logsDir string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>%s</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>%s/agent.out.log</string>
    <key>StandardErrorPath</key>
    <string>%s/agent.err.log</string>
</dict>
</plist>
`, launchAgentLabel, xmlEscape(exePath), xmlEscape(logsDir), xmlEscape(logsDir))
}

// xmlEscape escapes the five XML special characters in a string. Used for
// the executable path and logs directory in the plist body, in case any
// path component contains an ampersand or other quirky character.
func xmlEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return r.Replace(s)
}
