package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/timechamp/agent/internal/buffer"
	"github.com/timechamp/agent/internal/capture"
	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	agentsync "github.com/timechamp/agent/internal/sync"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[agent] ")

	cfg := config.Load()

	// Load auth token from OS keychain
	token, err := keychain.LoadToken()
	if err != nil || token == "" {
		// First run: check for invite token in env (set by installer)
		inviteToken := os.Getenv("TC_INVITE_TOKEN")
		if inviteToken == "" {
			log.Fatal("No auth token found. Run installer with TC_INVITE_TOKEN set.")
		}

		hostname, _ := os.Hostname()
		regToken, employeeID, orgID, regErr := agentsync.Register(
			cfg.APIURL, inviteToken, hostname, runtime.GOOS, osVersion(),
		)
		if regErr != nil {
			log.Fatalf("Registration failed: %v", regErr)
		}

		if saveErr := keychain.SaveToken(regToken); saveErr != nil {
			log.Fatalf("Failed to save token: %v", saveErr)
		}

		token = regToken
		cfg.OrgID = orgID
		log.Printf("Agent registered for org %s employee %s", orgID, employeeID)
	}

	// Open local SQLite buffer
	db, err := buffer.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("Failed to open buffer: %v", err)
	}
	defer db.Close()

	client := agentsync.NewClient(cfg.APIURL, token)
	uploader := agentsync.NewUploader(client, db)

	screenshotsDir := filepath.Join(cfg.DataDir, "screenshots")

	log.Printf("Agent started. Screenshot every %ds, sync every %ds",
		cfg.ScreenshotInterval, cfg.SyncInterval)

	// Tickers
	screenshotTicker := time.NewTicker(time.Duration(cfg.ScreenshotInterval) * time.Second)
	syncTicker := time.NewTicker(time.Duration(cfg.SyncInterval) * time.Second)
	activityTicker := time.NewTicker(10 * time.Second)
	inputTicker := time.NewTicker(60 * time.Second)
	pruneTicker := time.NewTicker(24 * time.Hour)

	defer screenshotTicker.Stop()
	defer syncTicker.Stop()
	defer activityTicker.Stop()
	defer inputTicker.Stop()
	defer pruneTicker.Stop()

	// Input counter (goroutine-safe)
	inputCounter := &capture.InputCounter{}

	// Track current window for activity session
	var currentWindow capture.ActiveWindow
	var windowStarted time.Time

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)

	for {
		select {

		case <-quit:
			log.Println("Shutting down agent...")
			// Final sync before exit
			_, _ = uploader.FlushActivity()
			_, _ = uploader.FlushKeystrokes()
			return

		case <-activityTicker.C:
			win, err := capture.GetActiveWindow()
			if err != nil {
				continue
			}

			// Detect idle
			idle, _ := capture.IdleSeconds()
			if idle >= cfg.IdleThreshold {
				// Record end of current session if one was active
				if currentWindow.AppName != "" {
					_ = db.InsertActivity(buffer.ActivityEvent{
						OrgID:       cfg.OrgID,
						AppName:     currentWindow.AppName,
						WindowTitle: currentWindow.WindowTitle,
						URL:         currentWindow.URL,
						StartedAt:   windowStarted,
						EndedAt:     time.Now(),
					})
					currentWindow = capture.ActiveWindow{}
				}
				continue
			}

			// Window changed — close old session, open new
			if win.AppName != currentWindow.AppName || win.WindowTitle != currentWindow.WindowTitle {
				if currentWindow.AppName != "" {
					_ = db.InsertActivity(buffer.ActivityEvent{
						OrgID:       cfg.OrgID,
						AppName:     currentWindow.AppName,
						WindowTitle: currentWindow.WindowTitle,
						URL:         currentWindow.URL,
						StartedAt:   windowStarted,
						EndedAt:     time.Now(),
					})
				}
				currentWindow = win
				windowStarted = time.Now()
			}

		case <-screenshotTicker.C:
			idle, _ := capture.IdleSeconds()
			if idle >= cfg.IdleThreshold {
				continue // skip screenshot when idle
			}

			path, err := capture.CaptureScreenshot(screenshotsDir)
			if err != nil {
				log.Printf("Screenshot failed: %v", err)
				continue
			}

			_ = db.InsertScreenshot(buffer.ScreenshotRecord{
				OrgID:      cfg.OrgID,
				LocalPath:  path,
				CapturedAt: time.Now(),
			})

		case <-inputTicker.C:
			keys, mouse := inputCounter.Drain()
			if keys > 0 || mouse > 0 {
				_ = db.InsertKeystroke(buffer.KeystrokeEvent{
					OrgID:       cfg.OrgID,
					KeysPerMin:  keys,
					MousePerMin: mouse,
					RecordedAt:  time.Now(),
				})
			}

		case <-syncTicker.C:
			if !client.IsAvailable() {
				continue
			}
			n1, err1 := uploader.FlushActivity()
			n2, err2 := uploader.FlushKeystrokes()
			n3, err3 := uploader.FlushScreenshots()
			if err1 != nil || err2 != nil || err3 != nil {
				log.Printf("Sync errors: activity=%v keystrokes=%v screenshots=%v",
					err1, err2, err3)
			} else {
				log.Printf("Synced: %d activity, %d keystrokes, %d screenshots",
					n1, n2, n3)
			}

		case <-pruneTicker.C:
			if err := db.PruneSynced(cfg.MaxBufferDays); err != nil {
				log.Printf("Prune error: %v", err)
			}
		}
	}
}

func osVersion() string {
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}
