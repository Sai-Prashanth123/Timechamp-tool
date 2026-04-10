//go:build !windows

package capture

import "context"

// StartWindowEventStream is a stub on non-Windows platforms.
// Returns nil, nil — a nil channel causes main.go to activate the poll fallback ticker.
func StartWindowEventStream(_ context.Context) (<-chan ActiveWindow, error) {
	return nil, nil
}
