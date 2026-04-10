//go:build windows

package capture

import "testing"

func TestMetricsSyscallFailure(t *testing.T) {
	c := &MetricsCollector{}
	c.lastValid = SystemMetrics{CPUPercent: 42.0, MemUsedMB: 1024, MemTotalMB: 8192}

	result := c.fallback()
	if result.CPUPercent != 42.0 {
		t.Errorf("expected fallback CPU=42.0, got %f", result.CPUPercent)
	}
	if result.MemUsedMB != 1024 {
		t.Errorf("expected fallback MemUsedMB=1024, got %d", result.MemUsedMB)
	}
}
