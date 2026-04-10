//go:build windows

package main

import (
	"github.com/timechamp/agent/internal/service"
	"github.com/timechamp/agent/internal/sleepwatch"
)

func forwardPowerEvents(w *sleepwatch.Watcher) {
	if !service.IsWindowsService() {
		return
	}
	safeGo("power-event-relay", func() {
		for evt := range service.PowerEvents {
			w.Signal(sleepwatch.EventType(evt))
		}
	})
}
