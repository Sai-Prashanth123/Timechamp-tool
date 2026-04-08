//go:build linux

package capture

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

// cpuStats tracks idle/total between calls for delta CPU %.
var cpuStats struct {
	lastIdle, lastTotal uint64
}

func getSystemMetrics() (SystemMetrics, error) {
	var m SystemMetrics

	// ---- CPU from /proc/stat ----
	if f, err := os.Open("/proc/stat"); err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "cpu ") {
				continue
			}
			fields := strings.Fields(line)[1:]
			var vals [10]uint64
			for i, fv := range fields {
				if i >= 10 {
					break
				}
				vals[i], _ = strconv.ParseUint(fv, 10, 64)
			}
			// user nice system idle iowait irq softirq steal guest guest_nice
			idle := vals[3] + vals[4]
			total := vals[0] + vals[1] + vals[2] + vals[3] + vals[4] + vals[5] + vals[6] + vals[7]
			if cpuStats.lastTotal > 0 {
				dIdle := idle - cpuStats.lastIdle
				dTotal := total - cpuStats.lastTotal
				if dTotal > 0 {
					m.CPUPercent = float64(dTotal-dIdle) / float64(dTotal) * 100.0
				}
			}
			cpuStats.lastIdle = idle
			cpuStats.lastTotal = total
			break
		}
		f.Close()
	}

	// ---- Memory from /proc/meminfo ----
	if f, err := os.Open("/proc/meminfo"); err == nil {
		scanner := bufio.NewScanner(f)
		var totalKB, availKB uint64
		for scanner.Scan() {
			line := scanner.Text()
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			val, _ := strconv.ParseUint(fields[1], 10, 64)
			switch fields[0] {
			case "MemTotal:":
				totalKB = val
			case "MemAvailable:":
				availKB = val
			}
		}
		f.Close()
		m.MemTotalMB = totalKB / 1024
		if totalKB >= availKB {
			m.MemUsedMB = (totalKB - availKB) / 1024
		}
	}

	// ---- Agent process RSS from /proc/self/status ----
	if f, err := os.Open("/proc/self/status"); err == nil {
		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "VmRSS:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					kb, _ := strconv.ParseUint(fields[1], 10, 64)
					m.AgentMemMB = kb / 1024
				}
				break
			}
		}
		f.Close()
	}

	return m, nil
}
