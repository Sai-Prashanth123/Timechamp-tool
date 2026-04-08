//go:build windows

package capture

import (
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// processQueryLimitedInfo works even for elevated / protected processes on Vista+.
const processQueryLimitedInfo = 0x1000

func getActiveWindow() (ActiveWindow, error) {
	hwnd, _, _ := getForegroundWindow.Call()
	if hwnd == 0 {
		return ActiveWindow{AppName: "Desktop", WindowTitle: ""}, nil
	}

	// ── Window title ──────────────────────────────────────────────────────────
	titleLen, _, _ := getWindowTextLength.Call(hwnd)
	title := ""
	if titleLen > 0 {
		buf := make([]uint16, titleLen+1)
		getWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		title = syscall.UTF16ToString(buf)
	}

	// ── Process name ──────────────────────────────────────────────────────────
	var pid uint32
	windows.GetWindowThreadProcessId(windows.HWND(hwnd), &pid)

	appName := processName(pid)
	if appName == "" {
		appName = "Unknown"
	}

	url := getBrowserURL(appName)
	return ActiveWindow{AppName: appName, WindowTitle: title, URL: url}, nil
}

// processName resolves a PID to the basename of the executable.
// Strategy:
//  1. QueryFullProcessImageNameW (Vista+, works for most processes)
//  2. GetModuleFileNameEx via psapi (legacy fallback)
//  3. WMIC query (fallback for elevated / SYSTEM processes)
func processName(pid uint32) string {
	if name := queryProcessImageName(pid); name != "" {
		return name
	}
	if name := moduleFileNameEx(pid); name != "" {
		return name
	}
	return wmicProcessName(pid)
}

// queryProcessImageName uses QueryFullProcessImageNameW — the most reliable
// method since Vista; works for processes running as other users or elevated.
func queryProcessImageName(pid uint32) string {
	handle, err := windows.OpenProcess(processQueryLimitedInfo, false, pid)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)

	var size uint32 = 260
	buf := make([]uint16, size)
	ret, _, _ := queryFullProcessImageName.Call(
		uintptr(handle),
		0,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
	)
	if ret == 0 {
		return ""
	}
	fullPath := syscall.UTF16ToString(buf[:size])
	return filepath.Base(fullPath)
}

// moduleFileNameEx uses psapi.GetModuleFileNameEx (legacy, requires VM_READ).
func moduleFileNameEx(pid uint32) string {
	handle, err := windows.OpenProcess(
		windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ, false, pid,
	)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(handle)

	buf := make([]uint16, 260)
	ret, _, _ := getModuleFileNameExProc.Call(
		uintptr(handle),
		0,
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(len(buf)),
	)
	if ret == 0 {
		return ""
	}
	fullPath := syscall.UTF16ToString(buf[:ret])
	return filepath.Base(fullPath)
}

// wmicProcessName falls back to `wmic process` for elevated/SYSTEM processes.
func wmicProcessName(pid uint32) string {
	cmd := exec.Command("wmic", "process", "where",
		"ProcessId="+uint32ToStr(pid), "get", "Name", "/format:value",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if after, ok := strings.CutPrefix(line, "Name="); ok {
			if name := strings.TrimSpace(after); name != "" {
				return name
			}
		}
	}
	return ""
}

func uint32ToStr(n uint32) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}
