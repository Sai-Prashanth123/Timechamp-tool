//go:build !windows

package capture

import "context"

// StartWindowEventStream is a stub on non-Windows platforms.
// It always returns nil, non-nil error so the caller falls back to polling.
func StartWindowEventStream(_ context.Context) (<-chan ActiveWindow, error) {
	return nil, nil // nil channel triggers poll fallback
}
