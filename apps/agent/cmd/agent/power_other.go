//go:build !windows

package main

import (
	"github.com/timechamp/agent/internal/sleepwatch"
	"github.com/timechamp/agent/internal/telemetry"
)

func forwardPowerEvents(_ *sleepwatch.Watcher, _ *telemetry.Reporter) {}
