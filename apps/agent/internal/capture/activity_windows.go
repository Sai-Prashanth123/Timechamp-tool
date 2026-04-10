//go:build windows

package capture

import (
	"context"
	"fmt"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// processQueryLimitedInfo works even for elevated / protected processes on Vista+.
const processQueryLimitedInfo = 0x1000

var lastKnownWindow atomic.Pointer[ActiveWindow]

const (
	EVENT_SYSTEM_FOREGROUND = 0x0003
	WINEVENT_OUTOFCONTEXT   = 0x0000
)

var (
	procSetWinEventHook = user32.NewProc("SetWinEventHook")
	procUnhookWinEvent  = user32.NewProc("UnhookWinEvent")
	procGetMessage      = user32.NewProc("GetMessageW")

	// globalWindowCh receives foreground-change events from the WinEvent callback.
	globalWindowCh atomic.Pointer[chan<- ActiveWindow]

	// winEventProcCallback must be created once at init time — not inside a goroutine.
	winEventProcCallback = syscall.NewCallback(winEventProc)
)

func winEventProc(hook, event, hwnd, idObj, idChild uintptr, thread, ts uint32) uintptr {
	if event != EVENT_SYSTEM_FOREGROUND {
		return 0
	}
	ch := globalWindowCh.Load()
	if ch == nil {
		return 0
	}
	win, err := getActiveWindowImpl()
	if err != nil {
		return 0
	}
	select {
	case *ch <- win:
	default: // drop if consumer is slow
	}
	return 0
}

// StartWindowEventStream installs a WinEventHook for EVENT_SYSTEM_FOREGROUND and
// returns a channel that receives an ActiveWindow on every foreground change.
// The hook goroutine is bound to an OS thread (required by SetWinEventHook).
// Returns nil,err if the hook cannot be installed — caller should poll instead.
func StartWindowEventStream(ctx context.Context) (<-chan ActiveWindow, error) {
	ch := make(chan ActiveWindow, 64)
	var sendCh chan<- ActiveWindow = ch
	globalWindowCh.Store(&sendCh)

	ready := make(chan error, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer globalWindowCh.Store(nil)

		hook, _, err := procSetWinEventHook.Call(
			EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
			0, winEventProcCallback, 0, 0,
			WINEVENT_OUTOFCONTEXT,
		)
		if hook == 0 {
			ready <- fmt.Errorf("SetWinEventHook: %w", err)
			return
		}
		defer procUnhookWinEvent.Call(hook)
		ready <- nil

		type MSG struct {
			HWND    uintptr
			Message uint32
			WParam  uintptr
			LParam  uintptr
			Time    uint32
			Pt      [2]int32
		}
		var msg MSG
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			r, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if r == 0 || r == ^uintptr(0) { // WM_QUIT or error
				return
			}
		}
	}()

	if err := <-ready; err != nil {
		return nil, err
	}
	return ch, nil
}

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
