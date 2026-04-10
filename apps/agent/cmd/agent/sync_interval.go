package main

import "time"

// adaptiveSyncInterval returns a sync interval based on buffer depth.
// A deeper buffer means events are accumulating faster than they sync;
// we respond by shortening the interval to drain it before the cap is hit.
func adaptiveSyncInterval(depth int) time.Duration {
	switch {
	case depth < 2000:
		return 30 * time.Second
	case depth < 6000:
		return 15 * time.Second
	case depth < 8000:
		return 7 * time.Second
	default:
		return 3 * time.Second
	}
}
