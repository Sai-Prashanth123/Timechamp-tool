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
	restartDelay    = 3 * time.Second
	maxCrashWindow  = 60 * time.Second
	maxCrashCount   = 5 // if agent crashes 5x in 60s, watchdog backs off
	backoffDuration = 5 * time.Minute
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[watchdog] ")

	agentPath := agentBinaryPath()
	log.Printf("Watching agent binary: %s", agentPath)

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
			log.Printf("Failed to start agent: %v — retrying in %s", err, restartDelay)
			time.Sleep(restartDelay)
			continue
		}

		log.Printf("Agent started (PID %d)", cmd.Process.Pid)
		err := cmd.Wait()
		elapsed := time.Since(startTime)

		if err != nil {
			log.Printf("Agent exited after %s: %v", elapsed.Round(time.Second), err)
		} else {
			log.Printf("Agent exited cleanly after %s", elapsed.Round(time.Second))
			// Clean exit means shutdown was intentional — don't restart
			return
		}

		// Crash tracking
		now := time.Now()
		if crashes == 0 || now.Sub(firstCrash) > maxCrashWindow {
			crashes = 1
			firstCrash = now
		} else {
			crashes++
		}

		if crashes >= maxCrashCount {
			log.Printf("Agent crashed %dx in %s — backing off for %s",
				crashes, maxCrashWindow, backoffDuration)
			time.Sleep(backoffDuration)
			crashes = 0
			continue
		}

		log.Printf("Restarting agent in %s (crash %d/%d in window)...",
			restartDelay, crashes, maxCrashCount)
		time.Sleep(restartDelay)
	}
}

func agentBinaryPath() string {
	exe, err := os.Executable()
	if err != nil {
		log.Fatal("Cannot determine watchdog path")
	}
	dir := filepath.Dir(exe)

	agentName := "timechamp-agent"
	if runtime.GOOS == "windows" {
		agentName += ".exe"
	}
	return filepath.Join(dir, agentName)
}
