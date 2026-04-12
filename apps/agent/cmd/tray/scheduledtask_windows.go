//go:build windows

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
)

// scheduledTaskName is the name of the per-user Task Scheduler task we
// register. Must be unique within the user's task store. Surfaces in
// taskschd.msc under "Task Scheduler Library" → root level.
const scheduledTaskName = "TimeChampTrayAutoStart"

// ensureScheduledTask registers a per-user Windows Task Scheduler task
// that auto-launches the tray on three triggers:
//   1. User logon (covers boot, sign-in, fast user switching)
//   2. Workstation unlock (covers wake-from-sleep, unlock-after-screensaver,
//      unlock-after-lock — anything that brings the user back to an active
//      session)
//
// The task is configured with RestartOnFailure so if the tray exits
// unexpectedly, the task service relaunches it after 1 minute, up to 5
// times. Combined with HKCU Run from ensureAutoStart(), this provides two
// independent auto-launch paths plus crash recovery.
//
// Per-user task — no UAC elevation required. Runs as the current user with
// limited privileges. Completely silent.
//
// Idempotent: checks if the task already exists before creating. On
// subsequent launches it's a single ~10ms schtasks.exe /Query subprocess
// call with no side effect.
//
// Failures are logged but never abort tray startup. Auto-start is a
// convenience layer; if the task service is unreachable or the user is in
// a locked-down corp environment that blocks Task Scheduler, the HKCU Run
// key from ensureAutoStart() still provides the basic logon trigger.
func ensureScheduledTask() {
	if scheduledTaskExists() {
		return
	}

	exe, err := os.Executable()
	if err != nil {
		log.Printf("[scheduledtask] could not resolve executable path: %v", err)
		return
	}
	abs, err := filepath.Abs(exe)
	if err != nil {
		log.Printf("[scheduledtask] could not absolutize executable path: %v", err)
		return
	}

	if err := installScheduledTask(abs); err != nil {
		log.Printf("[scheduledtask] install failed: %v", err)
		return
	}
	log.Printf("[scheduledtask] registered Task Scheduler entry: %s", scheduledTaskName)
}

// scheduledTaskExists returns true when our task is already registered for
// the current user. Uses schtasks.exe /Query — exit code 0 = exists, non-zero
// = doesn't exist (or schtasks itself failed, in which case we treat as
// "missing" and let installScheduledTask retry).
func scheduledTaskExists() bool {
	cmd := exec.Command("schtasks.exe", "/Query", "/TN", scheduledTaskName)
	// Hide the console window that exec.Command would otherwise spawn for
	// schtasks.exe. CREATE_NO_WINDOW = 0x08000000.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// installScheduledTask writes the task XML to a temp file then invokes
// schtasks.exe /Create /XML to register it. The XML approach (vs CLI flags)
// is the only way to express multiple triggers + RestartOnFailure in a
// single task.
//
// schtasks.exe is finicky about the XML file encoding — it requires UTF-16
// LE with a BOM. We write that explicitly via writeUTF16LEBOM rather than
// relying on Go's default UTF-8 file writes.
func installScheduledTask(exePath string) error {
	xml := buildTaskXML(exePath)

	tmp, err := os.CreateTemp("", "timechamp-task-*.xml")
	if err != nil {
		return fmt.Errorf("create temp xml: %w", err)
	}
	tmpPath := tmp.Name()
	tmp.Close()
	defer os.Remove(tmpPath)

	if err := writeUTF16LEBOM(tmpPath, xml); err != nil {
		return fmt.Errorf("write xml: %w", err)
	}

	// /F = force overwrite if exists (safety; shouldn't happen because we
	// already checked scheduledTaskExists, but harmless)
	cmd := exec.Command("schtasks.exe",
		"/Create",
		"/TN", scheduledTaskName,
		"/XML", tmpPath,
		"/F",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("schtasks /Create: %w (output: %s)",
			err, strings.TrimSpace(string(output)))
	}
	return nil
}

// buildTaskXML returns the Task Scheduler XML definition for our auto-start
// task. Triggers:
//   - LogonTrigger: fires once at user logon (catches boot, sign-in,
//     fast-user-switching)
//   - SessionStateChangeTrigger StateChange=SessionUnlock: fires when the
//     user unlocks the workstation, which includes wake-from-sleep
//
// Settings:
//   - RestartOnFailure: 1-minute interval, up to 5 retries — handles tray
//     crash recovery during a session
//   - DisallowStartIfOnBatteries=false, StopIfGoingOnBatteries=false: never
//     suspend just because we're on battery (user wants tracking everywhere)
//   - StartWhenAvailable=true: if the trigger fires while the task service
//     is unavailable, run as soon as it comes back
//   - Hidden=false: visible in taskschd.msc so the user can manage/disable it
//   - ExecutionTimeLimit=PT0S: no time limit (0 = unlimited)
//
// We use Author context with the current user's principal and LeastPrivilege
// run level — no UAC. The task runs only when the user is logged on (no
// password needed).
func buildTaskXML(exePath string) string {
	// XML-escape the path so spaces and special chars are preserved correctly.
	escapedExe := xmlEscape(exePath)

	return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Auto-start TimeChamp tray on logon and after wake-from-sleep / unlock. Created by the tray on first launch; no admin elevation required.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
    </SessionStateChangeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>5</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>` + escapedExe + `</Command>
    </Exec>
  </Actions>
</Task>`
}

// writeUTF16LEBOM writes the given string to the path encoded as UTF-16 LE
// with a byte-order mark. schtasks.exe /Create /XML rejects UTF-8 files —
// they must be UTF-16. This is undocumented but well-known among Windows
// automation people.
func writeUTF16LEBOM(path, content string) error {
	var buf bytes.Buffer
	// BOM
	buf.Write([]byte{0xFF, 0xFE})
	// Content as UTF-16 LE
	for _, r := range utf16.Encode([]rune(content)) {
		_ = binary.Write(&buf, binary.LittleEndian, r)
	}
	return os.WriteFile(path, buf.Bytes(), 0600)
}

// xmlEscape escapes the five XML special characters in a string. Used for
// the executable path in the task XML, in case the path contains an
// ampersand or other quirky char.
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
