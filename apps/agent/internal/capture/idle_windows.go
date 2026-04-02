//go:build windows

package capture

import (
	"fmt"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	kernel32         = windows.NewLazySystemDLL("kernel32.dll")
	getTickCount     = kernel32.NewProc("GetTickCount")
	getLastInputInfo = user32.NewProc("GetLastInputInfo")
)

type lastInputInfo struct {
	cbSize uint32
	dwTime uint32
}

func idleSeconds() (int, error) {
	var info lastInputInfo
	info.cbSize = uint32(unsafe.Sizeof(info))

	ret, _, err := getLastInputInfo.Call(uintptr(unsafe.Pointer(&info)))
	if ret == 0 {
		return 0, fmt.Errorf("GetLastInputInfo: %w", err)
	}

	tick, _, _ := getTickCount.Call()
	idleMs := uint32(tick) - info.dwTime
	return int(time.Duration(idleMs) * time.Millisecond / time.Second), nil
}
