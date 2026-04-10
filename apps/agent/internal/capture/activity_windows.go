//go:build windows

package capture

import (
	"fmt"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// processQueryLimitedInfo works even for elevated / protected processes on Vista+.
const processQueryLimitedInfo = 0x1000

var lastKnownWindow atomic.Pointer[ActiveWindow]

// getActiveWindow calls getActiveWindowImpl() with an 800ms timeout.
// If the call hangs (e.g. frozen compositor), returns the last known window
// so the event loop continues accumulating time on the previous app.
func getActiveWindow() (ActiveWindow, error) {
	type result struct {
		w   ActiveWindow
		err error
	}
	ch := make(chan result, 1)
	go func() {
		w, err := getActiveWindowImpl()
		ch <- result{w, err}
	}()
	select {
	case r := <-ch:
		if r.err == nil {
			lastKnownWindow.Store(&r.w)
		}
		return r.w, r.err
	case <-time.After(800 * time.Millisecond):
		if p := lastKnownWindow.Load(); p != nil {
			return *p, nil // return last known — duration keeps accumulating
		}
		return ActiveWindow{}, fmt.Errorf("GetActiveWindow timeout")
	}
}

func getActiveWindowImpl() (ActiveWindow, error) {
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
//  3. CreateToolhelp32Snapshot (pure Win32, no WMI dependency)
func processName(pid uint32) string {
	if name := queryProcessImageName(pid); name != "" {
		return name
	}
	if name := moduleFileNameEx(pid); name != "" {
		return name
	}
	return toolhelpProcessName(pid)
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

// toolhelpProcessName uses CreateToolhelp32Snapshot to find a process name by
// PID. Pure Win32 — no subprocess, no WMI dependency, returns in <1ms.
func toolhelpProcessName(pid uint32) string {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	if err := windows.Process32First(snap, &entry); err != nil {
		return ""
	}
	for {
		if entry.ProcessID == pid {
			return windows.UTF16ToString(entry.ExeFile[:])
		}
		if err := windows.Process32Next(snap, &entry); err != nil {
			break
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
