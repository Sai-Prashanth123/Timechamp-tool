//go:build darwin

package capture

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

// getSystemMetrics uses sysctl and vm_stat to gather memory + CPU info on macOS.
func getSystemMetrics() (SystemMetrics, error) {
	var m SystemMetrics

	// ---- Physical memory (sysctl hw.memsize) ----
	totalBytes, err := sysctlUint64("hw.memsize")
	if err == nil {
		m.MemTotalMB = totalBytes / (1024 * 1024)
	}

	// ---- Memory used (vm_stat) ----
	usedMB, _ := vmStatUsedMB()
	m.MemUsedMB = usedMB

	// ---- CPU % (top -l 1 -n 0 — lightweight single shot) ----
	cpuPct, _ := topCPUPercent()
	m.CPUPercent = cpuPct

	// ---- Agent process RSS ----
	m.AgentMemMB = selfRSSMB()

	return m, nil
}

// sysctlUint64 reads a sysctl key as uint64.
func sysctlUint64(name string) (uint64, error) {
	var val uint64
	size := uintptr(8)
	namep, err := syscall.BytePtrFromString(name)
	if err != nil {
		return 0, err
	}
	_, _, errno := syscall.Syscall6(
		syscall.SYS___SYSCTL,
		uintptr(unsafe.Pointer(namep)),
		uintptr(len(name)+1),
		uintptr(unsafe.Pointer(&val)),
		uintptr(unsafe.Pointer(&size)),
		0, 0,
	)
	if errno != 0 {
		return 0, errno
	}
	return val, nil
}

// vmStatUsedMB parses vm_stat output to estimate used memory in MiB.
func vmStatUsedMB() (uint64, error) {
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0, err
	}

	const pageSize = 16384 // 16 KiB on Apple Silicon, 4 KiB on Intel — use 4096 as safe default
	var activePages, wiredPages, compressedPages uint64

	for _, line := range strings.Split(string(out), "\n") {
		parseVMStatLine(line, "Pages active:", &activePages)
		parseVMStatLine(line, "Pages wired down:", &wiredPages)
		parseVMStatLine(line, "Pages occupied by compressor:", &compressedPages)
	}

	used := (activePages + wiredPages + compressedPages) * pageSize
	return used / (1024 * 1024), nil
}

func parseVMStatLine(line, prefix string, out *uint64) {
	if !strings.HasPrefix(line, prefix) {
		return
	}
	valStr := strings.TrimSuffix(strings.TrimSpace(strings.TrimPrefix(line, prefix)), ".")
	if v, err := strconv.ParseUint(valStr, 10, 64); err == nil {
		*out = v
	}
}

// topCPUPercent runs a minimal `top` invocation to get system-wide CPU %.
func topCPUPercent() (float64, error) {
	// top -l 1 -n 0 outputs one stats line; -stats avoids process table
	out, err := exec.Command("top", "-l", "1", "-n", "0", "-stats", "pid").Output()
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "CPU usage:") {
			// "CPU usage: 12.5% user, 5.2% sys, 82.2% idle"
			parts := strings.Split(line, ",")
			var user, sys float64
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if after, ok := strings.CutSuffix(p, "% user"); ok {
					user, _ = strconv.ParseFloat(after, 64)
				} else if after, ok := strings.CutSuffix(p, "% sys"); ok {
					sys, _ = strconv.ParseFloat(after, 64)
				}
			}
			return user + sys, nil
		}
	}
	return 0, nil
}

// selfRSSMB returns this process's RSS in MiB using /proc-equivalent on macOS.
func selfRSSMB() uint64 {
	pid := os.Getpid()
	out, err := exec.Command("ps", "-o", "rss=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return 0
	}
	kbStr := strings.TrimSpace(string(out))
	kb, _ := strconv.ParseUint(kbStr, 10, 64)
	return kb / 1024
}
