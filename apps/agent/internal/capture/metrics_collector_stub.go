//go:build !windows

package capture

// MetricsCollector is a stub on non-Windows platforms. The ring-buffer
// amortization logic lives in metrics_windows.go. On Linux/macOS this type
// exists only so that DefaultCollector() compiles; the returned pointer is
// always nil and callers must guard accordingly.
type MetricsCollector struct{}

// AddSample is a no-op stub on non-Windows platforms.
func (c *MetricsCollector) AddSample(_ SystemMetrics) {}

// Average is a no-op stub on non-Windows platforms; it always returns zero.
func (c *MetricsCollector) Average() SystemMetrics { return SystemMetrics{} }

// DefaultCollector returns nil on non-Windows platforms. Callers must guard:
//
//	if dc := capture.DefaultCollector(); dc != nil { dc.AddSample(m) }
func DefaultCollector() *MetricsCollector { return nil }
