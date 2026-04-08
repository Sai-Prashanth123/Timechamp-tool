package capture

// SystemMetrics holds a point-in-time snapshot of host resource utilisation.
type SystemMetrics struct {
	// CPUPercent is the overall CPU utilisation (0–100).
	CPUPercent float64
	// MemUsedMB is the amount of physical RAM in use (MiB).
	MemUsedMB uint64
	// MemTotalMB is the total physical RAM (MiB).
	MemTotalMB uint64
	// AgentCPUPercent is this process's CPU usage estimate (0–100).
	AgentCPUPercent float64
	// AgentMemMB is this process's RSS in MiB.
	AgentMemMB uint64
}

// GetSystemMetrics returns a current resource snapshot.
// The implementation is OS-specific.
func GetSystemMetrics() (SystemMetrics, error) {
	return getSystemMetrics()
}
