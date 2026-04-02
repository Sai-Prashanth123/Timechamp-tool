//go:build windows

package capture

import (
	"syscall"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	getForegroundWindow = user32.NewProc("GetForegroundWindow")
	getWindowText       = user32.NewProc("GetWindowTextW")
	getWindowTextLength = user32.NewProc("GetWindowTextLengthW")
)

var (
	psapi             = windows.NewLazySystemDLL("psapi.dll")
	getModuleBaseName = psapi.NewProc("GetModuleBaseNameW")
)

func getActiveWindow() (ActiveWindow, error) {
	hwnd, _, _ := getForegroundWindow.Call()
	if hwnd == 0 {
		return ActiveWindow{AppName: "Desktop", WindowTitle: ""}, nil
	}

	// Get window title
	titleLen, _, _ := getWindowTextLength.Call(hwnd)
	if titleLen == 0 {
		return ActiveWindow{AppName: "Unknown", WindowTitle: ""}, nil
	}
	buf := make([]uint16, titleLen+1)
	getWindowText.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	title := syscall.UTF16ToString(buf)

	// Get process name
	var pid uint32
	windows.GetWindowThreadProcessId(windows.HWND(hwnd), &pid)

	proc, err := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ, false, pid)
	if err != nil {
		return ActiveWindow{AppName: "Unknown", WindowTitle: title}, nil
	}
	defer windows.CloseHandle(proc)

	nameBuf := make([]uint16, 260)
	getModuleBaseName.Call(
		uintptr(proc),
		0,
		uintptr(unsafe.Pointer(&nameBuf[0])),
		uintptr(len(nameBuf)),
	)
	appName := syscall.UTF16ToString(nameBuf)
	if appName == "" {
		appName = "Unknown"
	}

	return ActiveWindow{AppName: appName, WindowTitle: title}, nil
}

// utf16PtrToString converts a UTF-16 pointer to a Go string.
func utf16PtrToString(p *uint16) string {
	if p == nil {
		return ""
	}
	var s []uint16
	for ptr := unsafe.Pointer(p); ; ptr = unsafe.Pointer(uintptr(ptr) + 2) {
		v := *(*uint16)(ptr)
		if v == 0 {
			break
		}
		s = append(s, v)
	}
	return string(utf16.Decode(s))
}
