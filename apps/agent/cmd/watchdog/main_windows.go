//go:build windows

package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/eventlog"
)

const (
	serviceName     = "TimeChampAgent"
	restartDelay    = 3 * time.Second
	maxCrashWindow  = 60 * time.Second
	maxCrashCount   = 5
	backoffDuration = 5 * time.Minute
)

func main() {
	// Detect whether we are running interactively (debug) or as a Windows Service
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Cannot determine service status: %v", err)
	}

	if isService {
		// Run as Windows Service
		if err := svc.Run(serviceName, &watchdogService{}); err != nil {
			// Log to Windows Event Log on failure
			elog, _ := eventlog.Open(serviceName)
			if elog != nil {
				elog.Error(1, err.Error())
				elog.Close()
			}
			os.Exit(1)
		}
		return
	}

	// Interactive / debug mode — run loop directly
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[watchdog] ")
	runWatchdogLoop()
}

// watchdogService implements golang.org/x/sys/windows/svc.Handler
type watchdogService struct{}

func (s *watchdogService) Execute(args []string, r <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown

	status <- svc.Status{State: svc.StartPending}

	done := make(chan struct{})
	go func() {
		runWatchdogLoop()
		close(done)
	}()

	status <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				// The agent process will exit via SIGTERM or process kill
				return false, 0
			}
		case <-done:
			return false, 0
		}
	}
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

		// Crash tracking
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
