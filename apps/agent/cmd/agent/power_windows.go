//go:build windows

package main

import (
	"log"

	"github.com/timechamp/agent/internal/service"
	"github.com/timechamp/agent/internal/sleepwatch"
	"github.com/timechamp/agent/internal/telemetry"
)

func forwardPowerEvents(w *sleepwatch.Watcher, cr *telemetry.Reporter) {
	if !service.IsWindowsService() {
		return
	}
	safeGo("power-event-relay", cr, func() {
		// range exits automatically when PowerEvents is closed (on service stop).
		for evt := range service.PowerEvents {
			switch sleepwatch.EventType(evt) {
			case sleepwatch.Suspend, sleepwatch.Resume:
				w.Signal(sleepwatch.EventType(evt))
			default:
				log.Printf("[sleep] unknown power event from SCM: %q", evt)
			}
		}
	})
}
