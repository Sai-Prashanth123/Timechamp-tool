//go:build windows

// windows_api.go declares all shared Windows lazy-DLL handles and proc
// references used across the capture package. Centralising them here avoids
// "redeclared in this block" errors when multiple files in the same build tag
// group reference the same DLL.

package capture

import "golang.org/x/sys/windows"

// ── DLL handles ──────────────────────────────────────────────────────────────

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")
	psapi    = windows.NewLazySystemDLL("psapi.dll")
)

// ── user32.dll ────────────────────────────────────────────────────────────────

var (
	getForegroundWindow    = user32.NewProc("GetForegroundWindow")
	getWindowText          = user32.NewProc("GetWindowTextW")
	getWindowTextLength    = user32.NewProc("GetWindowTextLengthW")
	getLastInputInfoProc   = user32.NewProc("GetLastInputInfo")
	enumChildWindowsProc   = user32.NewProc("EnumChildWindows")
	getClassNameProc       = user32.NewProc("GetClassNameW")
	sendMessageProc        = user32.NewProc("SendMessageW")
	isWindowVisibleProc    = user32.NewProc("IsWindowVisible")
)

// ── kernel32.dll ──────────────────────────────────────────────────────────────

var (
	getTickCount64Proc        = kernel32.NewProc("GetTickCount64")
	queryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	globalMemoryStatusEx      = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetCurrentThreadId    = kernel32.NewProc("GetCurrentThreadId")
)

// ── psapi.dll ─────────────────────────────────────────────────────────────────

var (
	getModuleFileNameExProc = psapi.NewProc("GetModuleFileNameExW")
	getProcessMemoryInfo    = psapi.NewProc("GetProcessMemoryInfo")
)
