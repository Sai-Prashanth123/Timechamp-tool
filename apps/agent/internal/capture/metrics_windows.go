//go:build windows

package capture

import (
	"log"
	"runtime"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	ntdll                    = windows.NewLazySystemDLL("ntdll.dll")
	ntQuerySystemInformation = ntdll.NewProc("NtQuerySystemInformation")

	psapiDll             = windows.NewLazySystemDLL("psapi.dll")
	getProcessMemoryInfo = psapiDll.NewProc("GetProcessMemoryInfo")
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
	idleTime   int64
	kernelTime int64
	userTime   int64
	_          [2]int64 // reserved
}

type metricsCollector struct {
	mu        sync.Mutex
	lastIdle  int64
	lastTotal int64
	lastRead  time.Time
	lastValid SystemMetrics
	// 4-sample ring buffer for amortization (Task 5)
	samples [4]SystemMetrics
	sampleN int
}

var defaultCollector = &metricsCollector{}

func (c *metricsCollector) fallback() SystemMetrics {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastValid
}

func (c *metricsCollector) collect() (SystemMetrics, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

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
	ret, _, _ := ntQuerySystemInformation.Call(
		8,
		uintptr(unsafe.Pointer(&buf[0])),
		size,
		uintptr(unsafe.Pointer(&retLen)),
	)
	if ret != 0 {
		log.Printf("[metrics] NtQuerySystemInformation NTSTATUS=0x%X — returning last valid", ret)
		return c.lastValid, nil
	}

	var totalIdle, totalKernel, totalUser int64
	for _, info := range buf {
		totalIdle += info.idleTime
		totalKernel += info.kernelTime
		totalUser += info.userTime
	}
	totalActive := totalKernel + totalUser

	if c.lastTotal > 0 {
		deltaTotal := totalActive - c.lastTotal
		deltaIdle := totalIdle - c.lastIdle
		if deltaTotal > 0 {
			m.CPUPercent = float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100.0
		}
	}
	c.lastIdle = totalIdle
	c.lastTotal = totalActive

	// ---- Agent process memory ----
	proc2, err := windows.GetCurrentProcess()
	if err == nil {
		var pmc processMemoryCounters
		pmc.cb = uint32(unsafe.Sizeof(pmc))
		getProcessMemoryInfo.Call(uintptr(proc2), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.cb))
		m.AgentMemMB = uint64(pmc.workingSetSize) / (1024 * 1024)
	}

	c.lastValid = m
	return m, nil
}

func getSystemMetrics() (SystemMetrics, error) {
	return defaultCollector.collect()
}

// DefaultCollector returns the package-level metricsCollector for use by
// the main event loop (Task 5: 4-sample amortization).
func DefaultCollector() *metricsCollector {
	return defaultCollector
}
