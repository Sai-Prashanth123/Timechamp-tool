//go:build !windows

package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const (
	serviceName     = "TimeChampAgent"
	restartDelay    = 3 * time.Second
	maxCrashWindow  = 60 * time.Second
	maxCrashCount   = 5
	backoffDuration = 5 * time.Minute
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[watchdog] ")
	runWatchdogLoop()
}

func runWatchdogLoop() {
	agentPath := agentBinaryPath()
	log.Printf("[watchdog] Watching agent binary: %s", agentPath)

	var (
		crashes    int
		firstCrash time.Time
	)

	for {
		cmd := exec.Command(agentPath)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Env = os.Environ()

		startTime := time.Now()

		if err := cmd.Start(); err != nil {
			log.Printf("[watchdog] Failed to start agent: %v — retrying in %s", err, restartDelay)
			time.Sleep(restartDelay)
			continue
		}

		log.Printf("[watchdog] Agent started (PID %d)", cmd.Process.Pid)
		err := cmd.Wait()
		elapsed := time.Since(startTime)

		if err != nil {
			log.Printf("[watchdog] Agent exited after %s: %v", elapsed.Round(time.Second), err)
		} else {
			log.Printf("[watchdog] Agent exited cleanly after %s", elapsed.Round(time.Second))
			return
		}

		now := time.Now()
		if crashes == 0 || now.Sub(firstCrash) > maxCrashWindow {
			crashes = 1
			firstCrash = now
		} else {
			crashes++
		}

		if crashes >= maxCrashCount {
			log.Printf("[watchdog] Agent crashed %dx in %s — backing off for %s",
				crashes, maxCrashWindow, backoffDuration)
			time.Sleep(backoffDuration)
			crashes = 0
			continue
		}

		log.Printf("[watchdog] Restarting agent in %s (crash %d/%d in window)...",
			restartDelay, crashes, maxCrashCount)
		time.Sleep(restartDelay)
	}
}

func agentBinaryPath() string {
	exe, err := os.Executable()
	if err != nil {
		log.Fatal("[watchdog] Cannot determine watchdog path")
	}
	dir := filepath.Dir(exe)

	agentName := "timechamp-agent"
	if runtime.GOOS == "windows" {
		agentName += ".exe"
	}
	return filepath.Join(dir, agentName)
}
