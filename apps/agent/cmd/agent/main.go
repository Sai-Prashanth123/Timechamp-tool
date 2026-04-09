package main

import (
	"context"
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
	"github.com/timechamp/agent/internal/health"
	"github.com/timechamp/agent/internal/capture"
	"github.com/timechamp/agent/internal/classifier"
	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/heartbeat"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/service"
	"github.com/timechamp/agent/internal/stream"
	agentsync "github.com/timechamp/agent/internal/sync"
	"github.com/timechamp/agent/internal/telemetry"
	"github.com/timechamp/agent/internal/updater"
)

// Build-time variables injected by -ldflags.
var (
	Version   = "dev"
	BuildDate = "unknown"
)

// urlCache holds the latest URL pushed from the browser extension native host.
var urlCache atomic.Value // stores string

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[agent] ")

	if service.IsWindowsService() {
		if err := service.RunAsService(run); err != nil {
			log.Fatalf("service run failed: %v", err)
		}
		return
	}
	run()
}

func run() {
	// On Windows, detach from the parent console so we don't receive
	// CTRL_C_EVENT / CTRL_CLOSE_EVENT signals when the launching terminal
	// or tray process exits. Stdout/Stderr are already redirected to a log
	// file by the tray, so losing the console handle is harmless.
	detachConsole()

	cfg := config.Load()
	log.Printf("Time Champ Agent %s (%s) on %s/%s", Version, BuildDate, runtime.GOOS, runtime.GOARCH)

	// Load saved identity.
	identity, err := config.LoadIdentity(cfg.DataDir)
	if err != nil {
		log.Printf("Warning: could not load identity: %v", err)
	}
	cfg.OrgID = identity.OrgID
	cfg.EmployeeID = identity.EmployeeID

	// Auth token — check env first (passed by tray on first launch), then keychain.
	token, err := keychain.LoadToken()
	if err != nil || token == "" {
		if envToken := os.Getenv("TC_AGENT_TOKEN"); envToken != "" {
			token = envToken
			// Persist to keychain for future launches without the env var.
			if saveErr := keychain.SaveToken(token); saveErr != nil {
				log.Printf("Warning: could not save token to keychain: %v", saveErr)
			}
		}
	}
	if token == "" {
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

	// Crash reporter: catches panics, sends stack trace to API, then re-panics.
	// Must be deferred AFTER identity is loaded so org/employee IDs are available.
	crashReporter := telemetry.NewReporter(
		cfg.APIURL,
		cfg.DataDir,
		cfg.OrgID,
		cfg.EmployeeID,
		Version,
	)
	defer crashReporter.Recover()

	// Optional TLS certificate pinning.
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

	// Fetch org config.
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

	// Browser extension URL relay listener.
	urlCache.Store("")
	go listenBrowserURLs()

	// Auto-update checker (hourly, skipped in dev builds).
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

	// ── Heartbeat queue ───────────────────────────────────────────────────────
	// Window events are pre-merged on the client before being committed to SQLite.
	// This eliminates fractured 1-second records and stores accurate session
	// durations — mirrors ActivityWatch's client-side RequestQueue with pre-merge.
	const (
		windowStream  = "window"
		pulsetime     = 2 * time.Second // poll_time(1s) + 1s margin
		commitThresh  = 60 * time.Second
	)

	hq := heartbeat.NewQueue(commitThresh, func(e heartbeat.Event) {
		// Called when a merged event is ready to persist.
		startedAt := e.Timestamp
		endedAt := e.Timestamp.Add(e.Duration)

		_ = db.InsertActivity(buffer.ActivityEvent{
			EmployeeID:  cfg.EmployeeID,
			OrgID:       cfg.OrgID,
			AppName:     e.Data["app"],
			WindowTitle: e.Data["title"],
			URL:         e.Data["url"],
			Category:    e.Data["category"],
			DurationMs:  e.Duration.Milliseconds(),
			StartedAt:   startedAt,
			EndedAt:     endedAt,
		})
	})

	// ── AFK state machine ─────────────────────────────────────────────────────
	// Adapted from ActivityWatch aw-watcher-afk state machine.
	// Tracks exact timestamps of AFK transitions instead of just checking idle.
	afkThreshold := time.Duration(cfg.IdleThreshold) * time.Second
	isAFK := false

	// Write PID file so the tray app can detect we are running.
	pidFile := filepath.Join(cfg.DataDir, "agent.pid")
	if pidData, err := json.Marshal(os.Getpid()); err == nil {
		_ = os.MkdirAll(cfg.DataDir, 0700)
		_ = os.WriteFile(pidFile, pidData, 0600)
	}
	defer os.Remove(pidFile)

	// Start local health HTTP server — tray uses this to detect liveness.
	healthSrv := health.New(Version)
	healthSrv.Start()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		healthSrv.Stop(ctx)
	}()

	// Check permissions at startup and re-check every 60s (macOS only — no-op on other platforms).
	capture.CheckAndRequestPermissions()
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			capture.CheckAndRequestPermissions()
		}
	}()

	log.Printf("Agent started. Screenshot every %ds, sync every %ds, idle threshold %ds",
		cfg.ScreenshotInterval, cfg.SyncInterval, cfg.IdleThreshold)

	// ── Tickers ────────────────────────────────────────────────────────────────
	// Window polling at 1 second (matches ActivityWatch aw-watcher-window default).
	windowTicker     := time.NewTicker(1 * time.Second)
	screenshotTicker := time.NewTicker(time.Duration(cfg.ScreenshotInterval) * time.Second)
	syncTicker       := agentsync.NewJitteredTicker(time.Duration(cfg.SyncInterval) * time.Second)
	inputTicker      := time.NewTicker(60 * time.Second)
	metricsTicker    := time.NewTicker(60 * time.Second)
	heartbeatTicker  := time.NewTicker(5 * time.Minute)
	pruneTicker      := time.NewTicker(24 * time.Hour)
	telemetryTicker  := time.NewTicker(60 * time.Second)

	defer windowTicker.Stop()
	defer screenshotTicker.Stop()
	defer syncTicker.Stop()
	defer inputTicker.Stop()
	defer metricsTicker.Stop()
	defer heartbeatTicker.Stop()
	defer pruneTicker.Stop()
	defer telemetryTicker.Stop()

	telemetryCollector := telemetry.NewCollector(Version, cfg.OrgID, cfg.EmployeeID)
	var (
		lastSyncSuccess   bool
		lastSyncLatencyMs int64
		syncErrorCount    int
	)

	inputCounter := &capture.InputCounter{}

	// Graceful shutdown.
	// Ignore SIGINT (Ctrl+C / CTRL_C_EVENT) entirely — this daemon runs in the
	// background and must not be killed by terminal interrupts from the parent
	// tray process or its console session. SIGTERM is the explicit stop signal.
	signal.Ignore(os.Interrupt)
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM)

	for {
		select {

		case sig := <-quit:
			log.Printf("Shutdown signal received (%v), flushing buffer...", sig)
			hq.FlushAll()
			if n, err := uploader.FlushActivity(); err != nil {
				log.Printf("Shutdown: flush activity error: %v", err)
			} else if n > 0 {
				log.Printf("Shutdown: flushed %d activity records", n)
			}
			if n, err := uploader.FlushKeystrokes(); err != nil {
				log.Printf("Shutdown: flush keystrokes error: %v", err)
			} else if n > 0 {
				log.Printf("Shutdown: flushed %d keystroke records", n)
			}
			if _, err := uploader.FlushScreenshots(); err != nil {
				log.Printf("Shutdown: flush screenshots error: %v", err)
			}
			if _, err := uploader.FlushMetrics(); err != nil {
				log.Printf("Shutdown: flush metrics error: %v", err)
			}
			if err := db.Checkpoint(); err != nil {
				log.Printf("Shutdown: WAL checkpoint error: %v", err)
			}
			log.Println("Agent shutdown complete.")
			return

		// ── Window poll (1 second) ─────────────────────────────────────────────
		case t := <-windowTicker.C:
			idleSec, _ := capture.IdleSeconds()
			idleDur := time.Duration(idleSec) * time.Second

			// ── AFK state machine (ActivityWatch pattern) ────────────────────
			if !isAFK && idleDur >= afkThreshold {
				// ACTIVE → AFK transition
				// Flush current window session immediately on going AFK.
				hq.FlushAll()
				isAFK = true
				log.Printf("[afk] user idle for %s — pausing tracking", idleDur.Round(time.Second))
			} else if isAFK && idleDur < afkThreshold {
				// AFK → ACTIVE transition
				isAFK = false
				log.Printf("[afk] user returned after %s idle", idleDur.Round(time.Second))
			}

			if isAFK {
				continue
			}

			// ── Window tracking ───────────────────────────────────────────────
			win, err := capture.GetActiveWindow()
			if err != nil || win.AppName == "" {
				continue
			}

			// Resolve URL via 3-layer detection: extension cache → native → title parsing.
			extURL := urlCache.Load().(string)
			url := capture.ResolveURL(win, extURL)

			// Classify app into a productivity category.
			cat := classifier.Classify(win.AppName, win.WindowTitle, url, classifier.DefaultRules)

			// Feed into heartbeat queue for pre-merge.
			hq.Push(windowStream, heartbeat.Event{
				Timestamp: t,
				Duration:  1 * time.Second,
				Data: map[string]string{
					"app":      win.AppName,
					"title":    win.WindowTitle,
					"url":      url,
					"category": cat,
				},
			}, pulsetime)

		// ── Screenshots ────────────────────────────────────────────────────────
		case <-screenshotTicker.C:
			// Skip if no screen recording permission (macOS) or user is idle.
			if !capture.HasScreenRecording() {
				continue
			}
			idleSec, _ := capture.IdleSeconds()
			if time.Duration(idleSec)*time.Second >= afkThreshold {
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

		// ── Input counts ───────────────────────────────────────────────────────
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

		// ── System metrics ─────────────────────────────────────────────────────
		case <-metricsTicker.C:
			m, err := capture.GetSystemMetrics()
			if err != nil {
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
				log.Printf("Warning: agent RAM %d MiB — check for memory leak", m.AgentMemMB)
			}

		// ── Sync flush ─────────────────────────────────────────────────────────
		case <-syncTicker.C:
			if !client.IsAvailable() {
				continue
			}
			// Flush heartbeat queue to SQLite first.
			hq.FlushAll()

			syncStart := time.Now()
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
			// Track telemetry state for the next self-report.
			lastSyncLatencyMs = time.Since(syncStart).Milliseconds()
			lastSyncSuccess = (err1 == nil && err2 == nil && err3 == nil && err4 == nil)
			if !lastSyncSuccess {
				syncErrorCount++
			}
			// Push live state to health endpoint so tray / monitoring see current health.
			bufferedForHealth, _ := db.CountActivity()
			healthSrv.SetMetrics(health.Metrics{
				BufferDepth:        bufferedForHealth,
				SyncHealthy:        lastSyncSuccess,
				LastSyncAt:         time.Now(),
				HasScreenRecording: capture.HasScreenRecording(),
				HasAccessibility:   capture.HasAccessibility(),
				URLDetectionLayer:  capture.URLDetectionLayer.Load(),
			})

		// ── Heartbeat ──────────────────────────────────────────────────────────
		case <-heartbeatTicker.C:
			if client.IsAvailable() {
				if err := client.Heartbeat(); err != nil {
					log.Printf("Heartbeat failed: %v", err)
				}
			}

		// ── Daily prune + WAL checkpoint ──────────────────────────────────────
		case <-pruneTicker.C:
			if err := db.PruneSynced(cfg.MaxBufferDays); err != nil {
				log.Printf("Prune error: %v", err)
			}
			if err := db.Checkpoint(); err != nil {
				log.Printf("WAL checkpoint error: %v", err)
			}

		// ── Agent telemetry ────────────────────────────────────────────────────
		case <-telemetryTicker.C:
			if !client.IsAvailable() {
				continue
			}
			buffered, _ := db.CountActivity()
			t := telemetryCollector.Collect(lastSyncSuccess, lastSyncLatencyMs, buffered, syncErrorCount)
			syncErrorCount = 0 // reset after reporting
			_ = client.Post("/agent/sync/telemetry", t)
		}
	}
}

// listenBrowserURLs starts a local TCP listener for the native messaging host.
func listenBrowserURLs() {
	ln, err := net.Listen("tcp", "127.0.0.1:27182")
	if err != nil {
		log.Printf("URL listener: %v (browser extension relay disabled)", err)
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

// updaterPublicKey is the ECDSA-P256 PEM public key for verifying update binaries.
// The matching private key must be stored securely and used to sign every release asset.
// To sign: sha256sum the binary, sign with: openssl dgst -sha256 -sign key.pem -out sig.bin agent && xxd -p -c 32 sig.bin > agent.sig
const updaterPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjQ2if0r+qsOcKW2AIzkhxnfxPuRf
+/SUHdAjO3jOzBrRcG1nQOht/wa/Z6JRAjrDhBqU3FEcOiKCRp1xXU47OA==
-----END PUBLIC KEY-----`
