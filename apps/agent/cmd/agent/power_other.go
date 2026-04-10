//go:build !windows

package main

import "github.com/timechamp/agent/internal/sleepwatch"

func forwardPowerEvents(_ *sleepwatch.Watcher) {}
