package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/timechamp/agent/internal/buffer"
	"github.com/timechamp/agent/internal/capture"
	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/service"
	"github.com/timechamp/agent/internal/stream"
	agentsync "github.com/timechamp/agent/internal/sync"
	"github.com/timechamp/agent/internal/updater"
)

// Build-time variables injected by -ldflags.
var (
	Version   = "dev"
	BuildDate = "unknown"
)

// urlCache is an atomic string holding the latest URL pushed from the browser
// extension native host. It is written by the URL listener goroutine and read
// by the activity loop.
var urlCache atomic.Value // stores string

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[agent] ")

	// When launched by Windows SCM, run in service mode.
	if service.IsWindowsService() {
		if err := service.RunAsService(run); err != nil {
			log.Fatalf("service run failed: %v", err)
		}
		return
	}

	run()
}

func run() {
	cfg := config.Load()
	log.Printf("Time Champ Agent %s (%s)", Version, BuildDate)

	// Load saved identity (orgID + employeeID) from previous registration.
	identity, err := config.LoadIdentity(cfg.DataDir)
	if err != nil {
		log.Printf("Warning: could not load identity: %v", err)
	}
	cfg.OrgID = identity.OrgID
	cfg.EmployeeID = identity.EmployeeID

	// Load auth token from OS keychain.
	token, err := keychain.LoadToken()
	if err != nil || token == "" {
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
		if saveErr := config.SaveIdentity(cfg.DataDir, orgID, employeeID); saveErr != nil {
			log.Fatalf("Failed to save identity: %v", saveErr)
		}

		token = regToken
		cfg.OrgID = orgID
		cfg.EmployeeID = employeeID
		log.Printf("Agent registered for org %s employee %s", orgID, employeeID)
	}

	// Optional TLS certificate pinning (set TC_TLS_PIN env to a SHA-256 hex fingerprint).
	var clientOpts []agentsync.ClientOption
	if pin := os.Getenv("TC_TLS_PIN"); pin != "" {
		clientOpts = append(clientOpts, agentsync.WithCertPin(pin))
	}

	// Open local SQLite buffer.
	db, err := buffer.Open(cfg.DataDir)
	if err != nil {
		log.Fatalf("Failed to open buffer: %v", err)
	}
	defer db.Close()

	client := agentsync.NewClient(cfg.APIURL, token, clientOpts...)
	uploader := agentsync.NewUploader(client, db)

	screenshotsDir := filepath.Join(cfg.DataDir, "screenshots")

	// Fetch org config (streaming, screenshot interval).
	orgCfg, _ := client.FetchOrgConfig()
	streamingEnabled := cfg.StreamingEnabled
	cameraEnabled := cfg.CameraEnabled
	audioEnabled := cfg.AudioEnabled
	maxStreamFPS := cfg.MaxStreamFPS
	if orgCfg != nil {
		if orgCfg.StreamingEnabled {
			streamingEnabled = true
		}
		if orgCfg.CameraEnabled {
			cameraEnabled = true
		}
		if orgCfg.AudioEnabled {
			audioEnabled = true
		}
		if orgCfg.MaxStreamFPS > 0 {
			maxStreamFPS = orgCfg.MaxStreamFPS
		}
	}
	if streamingEnabled && cfg.StreamingURL != "" {
		streamCfg := stream.Config{
			Enabled:       true,
			CameraEnabled: cameraEnabled,
			AudioEnabled:  audioEnabled,
			MaxFPS:        maxStreamFPS,
			WSURL:         cfg.StreamingURL,
			AgentToken:    token,
		}
		sm := stream.NewManager(streamCfg)
		sm.Start()
		defer sm.Stop()
		log.Printf("Streaming started: %s (camera=%v audio=%v fps=%d)",
			cfg.StreamingURL, cameraEnabled, audioEnabled, maxStreamFPS)
	}

	// Start URL listener for browser extension native messaging host.
	urlCache.Store("")
	go listenBrowserURLs()

	// Background auto-update check (once per hour).
	if Version != "dev" {
		go func() {
			ticker := time.NewTicker(1 * time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				if err := updater.CheckAndApply(updater.Config{
					CurrentVersion: Version,
					Repo:           "timechamp/agent",
					PublicKeyPEM:   updaterPublicKey,
					DataDir:        cfg.DataDir,
				}); err != nil {
					log.Printf("Auto-update check: %v", err)
				}
			}
		}()
	}

	log.Printf("Agent started. Screenshot every %ds, sync every %ds",
		cfg.ScreenshotInterval, cfg.SyncInterval)

	// Tickers.
	screenshotTicker := time.NewTicker(time.Duration(cfg.ScreenshotInterval) * time.Second)
	syncTicker       := time.NewTicker(time.Duration(cfg.SyncInterval) * time.Second)
	activityTicker   := time.NewTicker(10 * time.Second)
	inputTicker      := time.NewTicker(60 * time.Second)
	metricsTicker    := time.NewTicker(60 * time.Second) // collect metrics every minute
	pruneTicker      := time.NewTicker(24 * time.Hour)

	defer screenshotTicker.Stop()
	defer syncTicker.Stop()
	defer activityTicker.Stop()
	defer inputTicker.Stop()
	defer metricsTicker.Stop()
	defer pruneTicker.Stop()

	inputCounter := &capture.InputCounter{}

	var (
		currentWindow capture.ActiveWindow
		windowStarted time.Time
	)

	// Graceful shutdown.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)

	for {
		select {

		case <-quit:
			log.Println("Shutdown signal received, flushing buffer...")
			if currentWindow.AppName != "" {
				_ = db.InsertActivity(buffer.ActivityEvent{
					EmployeeID:  cfg.EmployeeID,
					OrgID:       cfg.OrgID,
					AppName:     currentWindow.AppName,
					WindowTitle: currentWindow.WindowTitle,
					URL:         currentWindow.URL,
					StartedAt:   windowStarted,
					EndedAt:     time.Now(),
				})
			}
			_, _ = uploader.FlushActivity()
			_, _ = uploader.FlushKeystrokes()
			_, _ = uploader.FlushScreenshots()
			_, _ = uploader.FlushMetrics()
			time.Sleep(2 * time.Second)
			log.Println("Shutting down agent.")
			return

		case <-activityTicker.C:
			win, err := capture.GetActiveWindow()
			if err != nil {
				continue
			}

			// Overlay URL from browser extension cache if available.
			if extURL := urlCache.Load().(string); extURL != "" && win.URL == "" {
				win.URL = extURL
			}

			idle, _ := capture.IdleSeconds()
			if idle >= cfg.IdleThreshold {
				if currentWindow.AppName != "" {
					_ = db.InsertActivity(buffer.ActivityEvent{
						EmployeeID:  cfg.EmployeeID,
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

			if win.AppName != currentWindow.AppName || win.WindowTitle != currentWindow.WindowTitle {
				if currentWindow.AppName != "" {
					_ = db.InsertActivity(buffer.ActivityEvent{
						EmployeeID:  cfg.EmployeeID,
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
			} else if win.URL != "" && win.URL != currentWindow.URL {
				// URL changed within the same window (in-page navigation).
				currentWindow.URL = win.URL
			}

		case <-screenshotTicker.C:
			idle, _ := capture.IdleSeconds()
			if idle >= cfg.IdleThreshold {
				continue
			}

			path, err := capture.CaptureScreenshot(screenshotsDir)
			if err != nil {
				log.Printf("Screenshot failed: %v", err)
				continue
			}

			_ = db.InsertScreenshot(buffer.ScreenshotRecord{
				EmployeeID: cfg.EmployeeID,
				OrgID:      cfg.OrgID,
				LocalPath:  path,
				CapturedAt: time.Now(),
			})

		case <-inputTicker.C:
			keys, mouse := inputCounter.Drain()
			if keys > 0 || mouse > 0 {
				_ = db.InsertKeystroke(buffer.KeystrokeEvent{
					EmployeeID:  cfg.EmployeeID,
					OrgID:       cfg.OrgID,
					KeysPerMin:  keys,
					MousePerMin: mouse,
					RecordedAt:  time.Now(),
				})
			}

		case <-metricsTicker.C:
			m, err := capture.GetSystemMetrics()
			if err != nil {
				log.Printf("Metrics capture error: %v", err)
				continue
			}
			_ = db.InsertMetrics(buffer.SystemMetricsEvent{
				EmployeeID:      cfg.EmployeeID,
				OrgID:           cfg.OrgID,
				CPUPercent:      m.CPUPercent,
				MemUsedMB:       m.MemUsedMB,
				MemTotalMB:      m.MemTotalMB,
				AgentCPUPercent: m.AgentCPUPercent,
				AgentMemMB:      m.AgentMemMB,
				RecordedAt:      time.Now(),
			})
			if m.AgentMemMB > 100 {
				log.Printf("Warning: agent RAM usage %d MiB exceeds 100 MiB target", m.AgentMemMB)
			}

		case <-syncTicker.C:
			if !client.IsAvailable() {
				continue
			}
			n1, err1 := uploader.FlushActivity()
			n2, err2 := uploader.FlushKeystrokes()
			n3, err3 := uploader.FlushScreenshots()
			n4, err4 := uploader.FlushMetrics()
			if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
				log.Printf("Sync errors: activity=%v keystrokes=%v screenshots=%v metrics=%v",
					err1, err2, err3, err4)
			} else if n1+n2+n3+n4 > 0 {
				log.Printf("Synced: %d activity, %d keystrokes, %d screenshots, %d metrics",
					n1, n2, n3, n4)
			}

		case <-pruneTicker.C:
			if err := db.PruneSynced(cfg.MaxBufferDays); err != nil {
				log.Printf("Prune error: %v", err)
			}
		}
	}
}

// listenBrowserURLs starts a local TCP listener for the native messaging host.
// It updates urlCache whenever a URL message arrives.
func listenBrowserURLs() {
	ln, err := net.Listen("tcp", "127.0.0.1:27182")
	if err != nil {
		// Port may be in use by another agent instance — that's OK.
		log.Printf("URL listener: %v (browser extension URLs will use native capture)", err)
		return
	}
	defer ln.Close()

	type urlMsg struct {
		Type string `json:"type"`
		URL  string `json:"url,omitempty"`
	}

	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		go func(c net.Conn) {
			defer c.Close()
			c.SetReadDeadline(time.Now().Add(2 * time.Second))

			var length uint32
			if err := binary.Read(c, binary.LittleEndian, &length); err != nil {
				return
			}
			if length > 4096 {
				return
			}
			buf := make([]byte, length)
			if _, err := io.ReadFull(c, buf); err != nil {
				return
			}
			var msg urlMsg
			if err := json.Unmarshal(buf, &msg); err != nil {
				return
			}
			if msg.Type == "url" && msg.URL != "" {
				urlCache.Store(msg.URL)
			}
		}(conn)
	}
}

func osVersion() string {
	return fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH)
}

// updaterPublicKey is the ECDSA-P256 PEM public key used to verify update binaries.
// Replace with your actual key before shipping production builds.
const updaterPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEPLACE_HOLDER_REPLACE_WITH_REAL_KEY==
-----END PUBLIC KEY-----`
