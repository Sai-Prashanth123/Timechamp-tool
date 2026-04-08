//go:build windows

package capture

import (
	"runtime"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ntdll                    = windows.NewLazySystemDLL("ntdll.dll")
	ntQuerySystemInformation = ntdll.NewProc("NtQuerySystemInformation")

	psapiDll              = windows.NewLazySystemDLL("psapi.dll")
	getProcessMemoryInfo  = psapiDll.NewProc("GetProcessMemoryInfo")
)

// MEMORYSTATUSEX from GlobalMemoryStatusEx.
type memoryStatusEx struct {
	dwLength                uint32
	dwMemoryLoad            uint32
	ullTotalPhys            uint64
	ullAvailPhys            uint64
	ullTotalPageFile        uint64
	ullAvailPageFile        uint64
	ullTotalVirtual         uint64
	ullAvailVirtual         uint64
	ullAvailExtendedVirtual uint64
}

// PROCESS_MEMORY_COUNTERS
type processMemoryCounters struct {
	cb                         uint32
	pageFaultCount             uint32
	peakWorkingSetSize         uintptr
	workingSetSize             uintptr
	quotaPeakPagedPoolUsage    uintptr
	quotaPagedPoolUsage        uintptr
	quotaPeakNonPagedPoolUsage uintptr
	quotaNonPagedPoolUsage     uintptr
	pagefileUsage              uintptr
	peakPagefileUsage          uintptr
}

// systemProcessorPerformanceInformation for NtQuerySystemInformation(8)
type systemProcessorPerfInfo struct {
	idleTime       int64
	kernelTime     int64
	userTime       int64
	_              [2]int64 // reserved
}

// cpuState tracks the previous sample for delta calculation.
var cpuState struct {
	lastIdle, lastTotal int64
	lastRead            time.Time
}

func getSystemMetrics() (SystemMetrics, error) {
	var m SystemMetrics

	// ---- Physical memory ----
	var ms memoryStatusEx
	ms.dwLength = uint32(unsafe.Sizeof(ms))
	proc := windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")
	proc.Call(uintptr(unsafe.Pointer(&ms)))
	m.MemTotalMB = ms.ullTotalPhys / (1024 * 1024)
	m.MemUsedMB = (ms.ullTotalPhys - ms.ullAvailPhys) / (1024 * 1024)

	// ---- CPU utilisation (delta since last call) ----
	numCPU := runtime.NumCPU()
	buf := make([]systemProcessorPerfInfo, numCPU)
	size := uintptr(numCPU) * unsafe.Sizeof(buf[0])
	var retLen uint32
	ntQuerySystemInformation.Call(
		8, // SystemProcessorPerformanceInformation
		uintptr(unsafe.Pointer(&buf[0])),
		size,
		uintptr(unsafe.Pointer(&retLen)),
	)

	var totalIdle, totalKernel, totalUser int64
	for _, info := range buf {
		totalIdle += info.idleTime
		totalKernel += info.kernelTime
		totalUser += info.userTime
	}
	totalActive := totalKernel + totalUser
	totalBusy := totalActive - totalIdle

	if cpuState.lastTotal > 0 {
		deltaTotal := totalActive - cpuState.lastTotal
		deltaIdle := totalIdle - cpuState.lastIdle
		if deltaTotal > 0 {
			m.CPUPercent = float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100.0
		}
	}
	cpuState.lastIdle = totalIdle
	cpuState.lastTotal = totalActive
	_ = totalBusy

	// ---- Agent process memory ----
	proc2, err := windows.GetCurrentProcess()
	if err == nil {
		var pmc processMemoryCounters
		pmc.cb = uint32(unsafe.Sizeof(pmc))
		getProcessMemoryInfo.Call(uintptr(proc2), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.cb))
		m.AgentMemMB = uint64(pmc.workingSetSize) / (1024 * 1024)
	}

	return m, nil
}
