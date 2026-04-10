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
	"github.com/timechamp/agent/internal/capture"
	"github.com/timechamp/agent/internal/health"
	agentlog "github.com/timechamp/agent/internal/logging"
	"github.com/timechamp/agent/internal/classifier"
	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/heartbeat"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/service"
	"github.com/timechamp/agent/internal/sleepwatch"
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
	// or tray process exits.
	detachConsole()

	cfg := config.Load()

	// Set up rotating log file (10 MB cap, 3 backups: agent.log.1/2/3).
	// The agent manages its own log; the tray no longer needs to redirect stdout.
	if err := os.MkdirAll(cfg.DataDir, 0700); err == nil {
		logPath := filepath.Join(cfg.DataDir, "agent.log")
		if logWriter, err := agentlog.NewRotatingWriter(logPath, 10*1024*1024); err == nil {
			log.SetOutput(logWriter)
			defer logWriter.Close()
		} else {
			log.Printf("Warning: could not open rotating log file: %v", err)
		}
	}

	log.Printf("Time Champ Agent %s (%s) on %s/%s", Version, BuildDate, runtime.GOOS, runtime.GOARCH)

	// Load saved identity.
	identity, err := config.LoadIdentity(cfg.DataDir)
	if err != nil {
		log.Printf("Warning: could not load identity: %v", err)
	}
	cfg.OrgID = identity.OrgID
	cfg.EmployeeID = identity.EmployeeID
	// If APIURL was not set via env var, fall back to the persisted value.
	if os.Getenv("TC_API_URL") == "" && identity.APIURL != "" {
		cfg.APIURL = identity.APIURL
	}

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
	safeGo("listenBrowserURLs", crashReporter, listenBrowserURLs)

	// Auto-update checker (hourly, skipped in dev builds).
	if Version != "dev" {
		safeGo("auto-updater", crashReporter, func() {
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
		})
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

		if err := db.InsertActivity(buffer.ActivityEvent{
			EmployeeID:  cfg.EmployeeID,
			OrgID:       cfg.OrgID,
			AppName:     e.Data["app"],
			WindowTitle: e.Data["title"],
			URL:         e.Data["url"],
			Category:    e.Data["category"],
			DurationMs:  e.Duration.Milliseconds(),
			StartedAt:   startedAt,
			EndedAt:     endedAt,
		}); err != nil {
			if buffer.IsDiskFull(err) {
				log.Printf("CRITICAL: disk full — cannot write activity to buffer. Free disk space to resume recording.")
			}
		}
	})

	// ── AFK state machine ─────────────────────────────────────────────────────
	// Adapted from ActivityWatch aw-watcher-afk state machine.
	// Tracks exact timestamps of AFK transitions instead of just checking idle.
	afkThreshold := time.Duration(cfg.IdleThreshold) * time.Second
	// isAFK is read and mutated only on the event-loop goroutine; no synchronisation needed.
	isAFK := false

	// Write PID file atomically (temp file + rename) so the tray never reads a
	// partial or empty file if the process crashes between open and write.
	pidFile := filepath.Join(cfg.DataDir, "agent.pid")
	if pidData, err := json.Marshal(os.Getpid()); err == nil {
		_ = os.MkdirAll(cfg.DataDir, 0700)
		tmp := pidFile + ".tmp"
		if writeErr := os.WriteFile(tmp, pidData, 0600); writeErr == nil {
			_ = os.Rename(tmp, pidFile)
		}
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
	safeGo("permission-checker", crashReporter, func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			capture.CheckAndRequestPermissions()
		}
	})

	// Sleep/resume detection — wall-clock drift watcher.
	sleepWatcher := sleepwatch.New()
	sleepWatcher.Start()
	defer sleepWatcher.Stop()

	// Wire Windows SCM power events → sleepwatch (Windows Service mode only).
	// service.PowerEvents is only defined on Windows; use the platform relay helper.
	forwardPowerEvents(sleepWatcher, crashReporter)

	log.Printf("Agent started. Screenshot every %ds, sync every %ds, idle threshold %ds",
		cfg.ScreenshotInterval, cfg.SyncInterval, cfg.IdleThreshold)

	// ── Tickers ────────────────────────────────────────────────────────────────
	// Window polling at 1 second (matches ActivityWatch aw-watcher-window default).
	windowTicker     := time.NewTicker(1 * time.Second)
	screenshotTicker := time.NewTicker(time.Duration(cfg.ScreenshotInterval) * time.Second)
	syncTicker       := agentsync.NewJitteredTicker(time.Duration(cfg.SyncInterval) * time.Second)
	inputTicker      := time.NewTicker(60 * time.Second)
	metricsTicker    := time.NewTicker(60 * time.Second)
	heartbeatTicker  := time.NewTicker(1 * time.Minute)
	configTicker     := time.NewTicker(5 * time.Minute)
	pruneTicker      := time.NewTicker(24 * time.Hour)
	telemetryTicker  := time.NewTicker(60 * time.Second)

	defer windowTicker.Stop()
	defer screenshotTicker.Stop()
	defer syncTicker.Stop()
	defer inputTicker.Stop()
	defer metricsTicker.Stop()
	defer heartbeatTicker.Stop()
	defer configTicker.Stop()
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

		// ── Sleep / resume ─────────────────────────────────────────────────────
		case event := <-sleepWatcher.C:
			withRecover("sleep-event", crashReporter, func() {
				switch event.Type {
				case sleepwatch.Suspend:
					log.Printf("[sleep] system going to sleep — flushing buffers")
					hq.FlushAll()
					_ = db.Checkpoint()
				case sleepwatch.Resume:
					log.Printf("[sleep] system resumed after %v", event.Duration.Round(time.Second))
					isAFK = false
					hq.FlushAll()
					capture.ResetIdleBaseline()
					safeGo("sleep-resume-flush", crashReporter, func() {
						client.ResetCircuit()
						// PostBestEffort: single attempt, no retry, bounded by HTTP timeout.
						// Avoids blocking for minutes if the network isn't up yet post-wake.
						client.PostBestEffort("/agent/sync/heartbeat", struct{}{})
						_, _ = uploader.FlushActivity()
						_, _ = uploader.FlushScreenshots()
						_, _ = uploader.FlushMetrics()
					})
					syncTicker.Reset(5 * time.Second)
				}
			})

		// ── Window poll (1 second) ─────────────────────────────────────────────
		case t := <-windowTicker.C:
			withRecover("window-poll", crashReporter, func() {
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
					return // was: continue
				}

				// ── Window tracking ───────────────────────────────────────────────
				win, err := capture.GetActiveWindow()
				if err != nil || win.AppName == "" {
					return // was: continue
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
			})

		// ── Screenshots ────────────────────────────────────────────────────────
		case <-screenshotTicker.C:
			withRecover("screenshot-tick", crashReporter, func() {
				// Skip if no screen recording permission (macOS) or user is idle.
				if !capture.HasScreenRecording() {
					return // was: continue
				}
				idleSec, _ := capture.IdleSeconds()
				if time.Duration(idleSec)*time.Second >= afkThreshold {
					return // was: continue
				}

				path, err := capture.CaptureScreenshot(screenshotsDir)
				if err != nil {
					log.Printf("Screenshot failed: %v", err)
					return // was: continue
				}
				if err := db.InsertScreenshot(buffer.ScreenshotRecord{
					EmployeeID: cfg.EmployeeID,
					OrgID:      cfg.OrgID,
					LocalPath:  path,
					CapturedAt: time.Now(),
				}); err != nil {
					if buffer.IsDiskFull(err) {
						log.Printf("CRITICAL: disk full — cannot store screenshot. Free disk space to resume recording.")
					}
				}
			})

		// ── Input counts ───────────────────────────────────────────────────────
		case <-inputTicker.C:
			withRecover("input-tick", crashReporter, func() {
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
			})

		// ── System metrics ─────────────────────────────────────────────────────
		case <-metricsTicker.C:
			withRecover("metrics-tick", crashReporter, func() {
				m, err := capture.GetSystemMetrics()
				if err != nil {
					return // was: continue
				}
				if err := db.InsertMetrics(buffer.SystemMetricsEvent{
					EmployeeID:      cfg.EmployeeID,
					OrgID:           cfg.OrgID,
					CPUPercent:      m.CPUPercent,
					MemUsedMB:       m.MemUsedMB,
					MemTotalMB:      m.MemTotalMB,
					AgentCPUPercent: m.AgentCPUPercent,
					AgentMemMB:      m.AgentMemMB,
					RecordedAt:      time.Now(),
				}); err != nil && buffer.IsDiskFull(err) {
					log.Printf("CRITICAL: disk full — cannot write metrics to buffer.")
				}
				if m.AgentMemMB > 100 {
					log.Printf("Warning: agent RAM %d MiB — check for memory leak", m.AgentMemMB)
				}
			})

		// ── Sync flush ─────────────────────────────────────────────────────────
		case <-syncTicker.C:
			withRecover("sync-tick", crashReporter, func() {
				if !client.IsAvailable() {
					return // was: continue
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
			})

		// ── Heartbeat ──────────────────────────────────────────────────────────
		case <-heartbeatTicker.C:
			withRecover("heartbeat-tick", crashReporter, func() {
				if client.IsAvailable() {
					if err := client.Heartbeat(); err != nil {
						log.Printf("Heartbeat failed: %v", err)
					}
				}
			})

		// ── Config hot-reload (every 5 min) ───────────────────────────────────
		// Re-fetches screenshot interval from API; resets ticker if changed.
		// This allows managers to adjust capture frequency without agent restart.
		case <-configTicker.C:
			withRecover("config-reload", crashReporter, func() {
				if !client.IsAvailable() {
					return // was: continue
				}
				newOrgCfg, err := client.FetchOrgConfig()
				if err != nil || newOrgCfg == nil {
					return // was: continue
				}
				if newOrgCfg.ScreenshotIntervalSec > 0 &&
					newOrgCfg.ScreenshotIntervalSec != cfg.ScreenshotInterval {
					cfg.ScreenshotInterval = newOrgCfg.ScreenshotIntervalSec
					screenshotTicker.Reset(time.Duration(newOrgCfg.ScreenshotIntervalSec) * time.Second)
					log.Printf("Config updated: screenshot interval → %ds", newOrgCfg.ScreenshotIntervalSec)
				}
			})

		// ── Daily prune + buffer cap + WAL checkpoint ─────────────────────────
		case <-pruneTicker.C:
			withRecover("prune-tick", crashReporter, func() {
				if err := db.PruneSynced(cfg.MaxBufferDays); err != nil {
					log.Printf("Prune error: %v", err)
				}
				// Cap unsynced rows so the buffer can't grow unbounded during long
				// offline periods (e.g. 7-day internet outage).
				const maxBufferedRows = 10_000
				if err := db.CapBuffer(maxBufferedRows); err != nil {
					log.Printf("Buffer cap error: %v", err)
				}
				if err := db.Checkpoint(); err != nil {
					log.Printf("WAL checkpoint error: %v", err)
				}
			})

		// ── Agent telemetry ────────────────────────────────────────────────────
		case <-telemetryTicker.C:
			withRecover("telemetry-tick", crashReporter, func() {
				if !client.IsAvailable() {
					return // was: continue
				}
				counts, _ := db.CountAll()
				buffered := counts["activity"]
				snap := telemetryCollector.Collect(lastSyncSuccess, lastSyncLatencyMs, buffered, syncErrorCount)
				syncErrorCount = 0 // reset after reporting
				client.PostBestEffort("/agent/sync/telemetry", snap)
			})
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

// safeGo runs fn in a new goroutine with panic recovery.
// On panic it logs the stack trace and reports to the crash API.
// Does NOT re-panic — goroutine panics cannot propagate to main anyway.
func safeGo(name string, cr *telemetry.Reporter, fn func()) {
	go func() {
		defer func() {
			if v := recover(); v != nil {
				buf := make([]byte, 16384)
				n := runtime.Stack(buf, false)
				log.Printf("PANIC in goroutine %s: %v\n%s", name, v, buf[:n])
				if cr != nil {
					cr.ReportGoroutinePanic(name, v, buf[:n])
				}
			}
		}()
		fn()
	}()
}

// withRecover wraps fn so a panic inside it is caught, reported to the crash
// API, and logged — but does NOT terminate the main event loop.
func withRecover(name string, cr *telemetry.Reporter, fn func()) {
	defer func() {
		if v := recover(); v != nil {
			buf := make([]byte, 16384)
			n := runtime.Stack(buf, false)
			log.Printf("PANIC in %s: %v\n%s", name, v, buf[:n])
			if cr != nil {
				cr.ReportGoroutinePanic(name, v, buf[:n])
			}
		}
	}()
	fn()
}

// updaterPublicKey is the ECDSA-P256 PEM public key for verifying update binaries.
// The matching private key must be stored securely and used to sign every release asset.
// To sign: sha256sum the binary, sign with: openssl dgst -sha256 -sign key.pem -out sig.bin agent && xxd -p -c 32 sig.bin > agent.sig
const updaterPublicKey = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjQ2if0r+qsOcKW2AIzkhxnfxPuRf
+/SUHdAjO3jOzBrRcG1nQOht/wa/Z6JRAjrDhBqU3FEcOiKCRp1xXU47OA==
-----END PUBLIC KEY-----`
