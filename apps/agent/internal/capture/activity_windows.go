//go:build windows

package capture

import (
	"syscall"
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

