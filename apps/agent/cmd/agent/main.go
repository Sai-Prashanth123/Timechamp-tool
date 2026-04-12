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
	stdsync "sync"
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

	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()

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
		const maxRegAttempts = 5
		var (
			regToken   string
			employeeID string
			orgID      string
			regErr     error
		)
		for i := range maxRegAttempts {
			if i > 0 {
				wait := time.Duration(10*(1<<uint(i))) * time.Second
				log.Printf("[agent] registration attempt %d/%d — retrying in %s", i+1, maxRegAttempts, wait)
				time.Sleep(wait)
			}
			regToken, employeeID, orgID, regErr = agentsync.Register(
				cfg.APIURL, inviteToken, hostname, runtime.GOOS, osVersion(),
			)
			if regErr == nil {
				break
			}
			log.Printf("[agent] registration failed (attempt %d/%d): %v", i+1, maxRegAttempts, regErr)
		}
		if regErr != nil {
			// Fallback: if previously registered, use saved token and identity.
			savedToken, tokenErr := keychain.LoadToken()
			if tokenErr != nil || savedToken == "" {
				log.Fatalf("[agent] registration failed after %d attempts and no saved token: %v", maxRegAttempts, regErr)
			}
			regToken = savedToken
			identity, idErr := config.LoadIdentity(cfg.DataDir)
			if idErr != nil {
				log.Fatalf("[agent] registration failed and cannot load identity: %v", idErr)
			}
			orgID = identity.OrgID
			employeeID = identity.EmployeeID
			log.Printf("[agent] using existing keychain token (API unreachable at startup)")
		} else {
			if saveErr := keychain.SaveToken(regToken); saveErr != nil {
				log.Fatalf("Failed to save token: %v", saveErr)
			}
			if saveErr := config.SaveIdentity(cfg.DataDir, orgID, employeeID, cfg.APIURL); saveErr != nil {
				log.Fatalf("Failed to save identity: %v", saveErr)
			}
			log.Printf("Agent registered for org %s employee %s", orgID, employeeID)
		}
		token = regToken
		cfg.OrgID = orgID
		cfg.EmployeeID = employeeID
	}

	// R7: ensure auto-start at user login. Platform-specific implementation:
	//   - macOS:   writes ~/Library/LaunchAgents/com.timechamp.agent.plist
	//   - Windows: no-op (the tray handles it via cmd/tray/autostart_windows.go)
	//   - Linux:   no-op (init system varies; manual systemd user unit recommended)
	// Idempotent on all platforms — safe to call on every launch. Failures are
	// logged but never block startup. Called AFTER successful token load so we
	// only auto-register a binary that has a valid identity and won't fatal-loop.
	ensureAutoStart()

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

	// WriteBatcher accumulates activity events and flushes as a single SQLite
	// transaction every 5 seconds or when 200 events are queued — ~100x faster
	// than per-event inserts because the WAL gets one fsync per batch.
	batcher := buffer.NewWriteBatcher(db, 5*time.Second, 200)

	// screenshotSig decouples the ticker from the capture pipeline.
	// A buffered capacity of 1 means a slow capture naturally skips the next
	// tick instead of queuing up — backpressure without memory growth.
	screenshotSig := make(chan struct{}, 1)
	safeGo("screenshot-worker", crashReporter, func() {
		for {
			select {
			case <-runCtx.Done():
				return
			case <-screenshotSig:
				path, err := capture.CaptureScreenshot(screenshotsDir)
				if err != nil {
					if buffer.IsDiskFull(err) {
						log.Printf("[screenshot] CRITICAL: disk full — cannot store screenshot")
					} else {
						log.Printf("[screenshot] capture failed: %v", err)
					}
					continue
				}
				if err := db.InsertScreenshot(buffer.ScreenshotRecord{
					EmployeeID: cfg.EmployeeID,
					OrgID:      cfg.OrgID,
					LocalPath:  path,
					CapturedAt: time.Now().UTC(),
				}); err != nil {
					log.Printf("[screenshot] buffer insert failed: %v", err)
				}
			}
		}
	})

	hq := heartbeat.NewQueue(commitThresh, func(e heartbeat.Event) {
		// Called when a merged event is ready to persist — route via batcher.
		batcher.Add(buffer.ActivityEvent{
			EmployeeID:  cfg.EmployeeID,
			OrgID:       cfg.OrgID,
			AppName:     e.Data["app"],
			WindowTitle: e.Data["title"],
			URL:         e.Data["url"],
			Category:    e.Data["category"],
			DurationMs:  e.Duration.Milliseconds(),
			StartedAt:   e.Timestamp,
			EndedAt:     e.Timestamp.Add(e.Duration),
		})
	})

	// ── AFK state machine ─────────────────────────────────────────────────────
	// Adapted from ActivityWatch aw-watcher-afk state machine.
	// Tracks exact timestamps of AFK transitions instead of just checking idle.
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
	screenshotTicker   := time.NewTicker(time.Duration(cfg.ScreenshotInterval) * time.Second)
	syncTicker         := agentsync.NewJitteredTicker(time.Duration(cfg.SyncInterval) * time.Second)
	inputTicker        := time.NewTicker(60 * time.Second)
	metricsTicker      := time.NewTicker(15 * time.Second)
	metricsFlushTicker := time.NewTicker(60 * time.Second)
	heartbeatTicker    := time.NewTicker(1 * time.Minute)
	configTicker       := time.NewTicker(5 * time.Minute)
	pruneTicker        := time.NewTicker(24 * time.Hour)
	telemetryTicker    := time.NewTicker(60 * time.Second)
	idleTicker         := time.NewTicker(1 * time.Second)
	// Live-view command poll — every 1s the agent asks the API whether a
	// manager is currently watching its live feed. When true, enters burst
	// capture mode. 1s is the lowest cadence that's still cheap (single
	// JSON GET returning a boolean) and keeps the worst-case startup delay
	// for Watch Live under ~1s — half the old 2s budget, which is the
	// difference between "feels instant" and "feels laggy".
	commandTicker := time.NewTicker(1 * time.Second)
	// Burst capture ticker — 2 FPS screenshots when in live-view mode. Starts
	// stopped (period 24h as a no-op placeholder); Reset() activates it on
	// enter / Stop() deactivates it on exit.
	burstTicker := time.NewTicker(24 * time.Hour)
	burstTicker.Stop()
	var liveViewOn bool

	defer screenshotTicker.Stop()
	defer syncTicker.Stop()
	defer inputTicker.Stop()
	defer metricsTicker.Stop()
	defer metricsFlushTicker.Stop()
	defer heartbeatTicker.Stop()
	defer configTicker.Stop()
	defer pruneTicker.Stop()
	defer telemetryTicker.Stop()
	defer idleTicker.Stop()
	defer commandTicker.Stop()
	defer burstTicker.Stop()

	// Try event-driven window tracking first; fall back to 1s polling if hook fails.
	windowEvents, hookErr := capture.StartWindowEventStream(runCtx)
	if hookErr != nil {
		log.Printf("[agent] window hook failed (%v) — falling back to 1s poll", hookErr)
		windowEvents = nil
	}

	var windowFallbackTicker *time.Ticker
	var windowFallbackC <-chan time.Time
	if windowEvents == nil {
		windowFallbackTicker = time.NewTicker(time.Second)
		windowFallbackC = windowFallbackTicker.C
		defer windowFallbackTicker.Stop()
	}

	telemetryCollector := telemetry.NewCollector(Version, cfg.OrgID, cfg.EmployeeID)
	var (
		lastSyncSuccess   bool
		lastSyncLatencyMs int64
		syncErrorCount    int
		// Rate-limit state for the "circuit open, sync skipped" observability
		// log. Without this, long outages leave agent.log completely silent —
		// operators can't distinguish "idle, nothing to sync" from "stuck,
		// API unreachable for 40 minutes". We log at most once per minute.
		lastCircuitLogAt time.Time
		// Rate-limit state for the [commands] FetchCommands failure log. The
		// command poll fires every 2 seconds, so without rate-limiting an
		// extended outage produces hundreds of identical lines per minute and
		// drowns out everything useful in agent.log. Same once-per-minute cap
		// as lastCircuitLogAt.
		lastCommandLogAt time.Time
	)

	inputCounter := &capture.InputCounter{}

	// classifierCache avoids re-running 50+ regexes for apps seen before.
	classifierCache := classifier.NewCache(512)

	pushWindow := func(win capture.ActiveWindow, ts time.Time) {
		extURL := urlCache.Load().(string)
		url := capture.ResolveURL(win, extURL)
		cat := classifierCache.Classify(win.AppName, win.WindowTitle, url, classifier.DefaultRules)
		hq.Push(windowStream, heartbeat.Event{
			Timestamp: ts,
			Duration:  1 * time.Second,
			Data: map[string]string{
				"app":      win.AppName,
				"title":    win.WindowTitle,
				"url":      url,
				"category": cat,
			},
		}, pulsetime)
	}

	// Graceful shutdown.
	// Ignore SIGINT (Ctrl+C / CTRL_C_EVENT) entirely — this daemon runs in the
	// background and must not be killed by terminal interrupts from the parent
	// tray process or its console session. SIGTERM is the explicit stop signal.
	signal.Ignore(os.Interrupt)
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGTERM)
		<-quit
		log.Printf("[agent] SIGTERM received — shutting down (8s deadline)")
		cancelRun()
		time.AfterFunc(8*time.Second, func() {
			log.Printf("[agent] shutdown deadline exceeded — forcing exit")
			os.Exit(0)
		})
	}()

	// ── Rolling idle state (3-sample median + 2-sample AFK-exit hysteresis) ───
	// idleSamples is a ring buffer written once per idleTicker tick (1s).
	// medianUint32 filters single-sample spikes before the threshold comparison.
	// activeConfirmCount requires 2 consecutive below-threshold readings to exit
	// AFK so that a momentary input glitch does not prematurely end an AFK period.
	var (
		idleSamples        [3]uint32
		idleSampleIdx      int
		activeConfirmCount int
	)

	for {
		select {

		case <-runCtx.Done():
			log.Printf("[agent] context cancelled — flushing and exiting")
			hq.FlushAll()
			batcher.Flush() // drain any batched activity events before uploading
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

		// ── Idle / AFK tick (1 second) ─────────────────────────────────────────────
		case <-idleTicker.C:
			withRecover("idle-tick", crashReporter, func() {
				rawIdle, _ := capture.IdleSeconds()
				idleSamples[idleSampleIdx%3] = uint32(rawIdle)
				idleSampleIdx++
				idleSec := medianUint32(idleSamples)

				// Hysteresis: require 2 consecutive below-threshold readings to exit AFK
				// so a momentary input glitch does not prematurely end an AFK period.
				if idleSec < uint32(cfg.IdleThreshold) {
					activeConfirmCount++
				} else {
					activeConfirmCount = 0
				}
				prevAFK := isAFK
				if isAFK && activeConfirmCount >= 2 {
					isAFK = false
				} else if !isAFK && idleSec >= uint32(cfg.IdleThreshold) {
					isAFK = true
				}
				if prevAFK != isAFK {
					if isAFK {
						hq.FlushAll()
						log.Printf("[afk] user idle for %ds — pausing tracking", idleSec)
					} else {
						log.Printf("[afk] user returned after %ds idle", idleSec)
					}
				}
			})

		// ── Window event (hook or poll fallback) ───────────────────────────────────
		case win, ok := <-windowEvents:
			if !ok {
				log.Printf("[agent] window event stream closed — falling back to 1s poll")
				windowEvents = nil
				if windowFallbackTicker == nil {
					windowFallbackTicker = time.NewTicker(time.Second)
					windowFallbackC = windowFallbackTicker.C
					defer windowFallbackTicker.Stop()
				}
				continue
			}
			withRecover("window-event", crashReporter, func() {
				if isAFK || win.AppName == "" {
					return
				}
				pushWindow(win, time.Now())
			})

		// ── Window poll fallback (only active when hook is unavailable) ────────────
		case <-windowFallbackC:
			withRecover("window-poll", crashReporter, func() {
				if isAFK {
					return
				}
				win, err := capture.GetActiveWindow()
				if err != nil || win.AppName == "" {
					return
				}
				pushWindow(win, time.Now())
			})

		// ── Screenshots ────────────────────────────────────────────────────────
		case <-screenshotTicker.C:
			withRecover("screenshot-tick", crashReporter, func() {
				// Skip the normal interval capture while a live-view burst is
				// active — the burst ticker is already taking frames at 1 FPS
				// and we would just duplicate them.
				if liveViewOn {
					return
				}
				// AFK / permission checks happen here (on the event-loop goroutine
				// where isAFK is safe to read). Only send the signal if we should capture.
				if isAFK || !capture.HasScreenRecording() {
					return
				}
				select {
				case screenshotSig <- struct{}{}:
				default:
					log.Printf("[screenshot] skipping tick: previous capture still in progress")
				}
			})

		// ── Live-view command poll (2s) ───────────────────────────────────────
		// Polls the API for out-of-band instructions. When a manager is actively
		// watching this agent's live feed, the API sets a Redis flag that this
		// poll picks up, flipping the agent into burst-capture mode. Intentionally
		// short interval so "Watch Live" feels responsive.
		case <-commandTicker.C:
			withRecover("command-poll", crashReporter, func() {
				cmds, err := client.FetchCommands()
				if err != nil {
					// Rate-limited to once per minute. The 2s poll cadence
					// would otherwise spam ~30 identical lines per minute
					// during any outage and drown out everything else.
					if time.Since(lastCommandLogAt) > 60*time.Second {
						log.Printf("[commands] FetchCommands failed: %v", err)
						lastCommandLogAt = time.Now()
					}
					return
				}
				if cmds == nil {
					return
				}
				if cmds.LiveView && !liveViewOn {
					liveViewOn = true
					// 2 FPS — fast enough to feel like a live stream while
					// keeping Supabase row churn and upload bandwidth sane.
					// The browser consumes each frame via the monitoring WS
					// (`employee:screenshot` event carries the presigned URL)
					// so the viewer sees every frame as soon as saveScreenshot
					// lands in the DB — no polling jitter.
					burstTicker.Reset(500 * time.Millisecond)
				} else if !cmds.LiveView && liveViewOn {
					liveViewOn = false
					burstTicker.Stop()
				}
			})

		// ── Live-view burst capture (1 FPS while watched) ─────────────────────
		// Captures a screenshot every 1 second and uploads it directly via the
		// existing Supabase pipeline — bypasses the local SQLite buffer so live
		// frames land with minimum latency. Failed uploads are dropped (frames
		// are ephemeral). No new traffic signature visible to the end user.
		case <-burstTicker.C:
			withRecover("burst-capture", crashReporter, func() {
				if isAFK || !capture.HasScreenRecording() {
					return
				}
				path, capErr := capture.CaptureScreenshot(screenshotsDir)
				if capErr != nil {
					return
				}
				_ = uploader.BurstUploadScreenshot(path, time.Now().UTC())
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

		// ── System metrics (sample every 15s) ─────────────────────────────────
		case <-metricsTicker.C:
			withRecover("metrics-sample", crashReporter, func() {
				m, err := capture.GetSystemMetrics()
				if err != nil {
					return
				}
				if dc := capture.DefaultCollector(); dc != nil {
					dc.AddSample(m)
				}
				if m.AgentMemMB > 100 {
					log.Printf("Warning: agent RAM %d MiB — check for memory leak", m.AgentMemMB)
				}
			})

		// ── System metrics flush (average 4 samples, insert every 60s) ────────
		case <-metricsFlushTicker.C:
			withRecover("metrics-flush", crashReporter, func() {
				dc := capture.DefaultCollector()
				if dc == nil {
					return
				}
				avg := dc.Average()
				if err := db.InsertMetrics(buffer.SystemMetricsEvent{
					EmployeeID:      cfg.EmployeeID,
					OrgID:           cfg.OrgID,
					CPUPercent:      avg.CPUPercent,
					MemUsedMB:       avg.MemUsedMB,
					MemTotalMB:      avg.MemTotalMB,
					AgentCPUPercent: avg.AgentCPUPercent,
					AgentMemMB:      avg.AgentMemMB,
					RecordedAt:      time.Now(),
				}); err != nil && buffer.IsDiskFull(err) {
					log.Printf("CRITICAL: disk full — cannot write metrics to buffer.")
				}
			})

		// ── Sync flush ─────────────────────────────────────────────────────────
		case <-syncTicker.C:
			withRecover("sync-tick", crashReporter, func() {
				if !client.IsAvailable() {
					// Rate-limited observability log — at most one line per
					// minute during an extended outage, so operators reading
					// agent.log can tell "stuck on circuit open" from "idle".
					if time.Since(lastCircuitLogAt) > 60*time.Second {
						cb := client.State()
						buffered, _ := db.CountActivity()
						log.Printf("[sync] skipped: circuit=%s failures=%d buffered=%d",
							cb.State, cb.Failures, buffered)
						lastCircuitLogAt = time.Now()
					}
					return // was: continue
				}
				// Flush heartbeat queue to SQLite first.
				hq.FlushAll()

				syncStart := time.Now()
				// Run all four flush operations in parallel goroutines.
				// Sequentially each flush blocks for the duration of its
				// HTTP round-trip; in parallel they overlap, cutting wall-
				// clock latency from sum-of-all-four to max-of-all-four.
				// Each Flush* method is independently safe — they read
				// disjoint buffer rows and write to different API endpoints.
				var (
					n1, n2, n3, n4         int
					err1, err2, err3, err4 error
					wg                     stdsync.WaitGroup
				)
				wg.Add(4)
				go func() { defer wg.Done(); n1, err1 = uploader.FlushActivity() }()
				go func() { defer wg.Done(); n2, err2 = uploader.FlushKeystrokes() }()
				go func() { defer wg.Done(); n3, err3 = uploader.FlushScreenshots() }()
				go func() { defer wg.Done(); n4, err4 = uploader.FlushMetrics() }()
				wg.Wait()
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
				if bufferedForHealth > 6000 {
					log.Printf("[sync] WARNING: buffer depth=%d (>6000), increasing sync frequency", bufferedForHealth)
				}
				if bufferedForHealth > 9500 {
					log.Printf("[sync] CRITICAL: buffer depth=%d (>9500) — events may be dropped soon", bufferedForHealth)
				}
				cb := client.State()
				healthSrv.SetMetrics(health.Metrics{
					BufferDepth:        bufferedForHealth,
					SyncHealthy:        lastSyncSuccess,
					LastSyncAt:         time.Now(),
					HasScreenRecording: capture.HasScreenRecording(),
					HasAccessibility:   capture.HasAccessibility(),
					URLDetectionLayer:  capture.URLDetectionLayer.Load(),
					DroppedEvents:      db.DroppedEvents.Load(),
					CircuitState:       cb.State,
					CircuitOpenedAt:    cb.OpenedAt,
					CircuitFailures:    cb.Failures,
				})
				// Adapt sync frequency to drain a growing buffer faster.
				syncTicker.Reset(adaptiveSyncInterval(bufferedForHealth))
			})

		// ── Heartbeat ──────────────────────────────────────────────────────────
		case <-heartbeatTicker.C:
			withRecover("heartbeat-tick", crashReporter, func() {
				if client.IsAvailable() {
					// Report the agent's current AFK state so the live-monitoring
					// dashboard can flip the presence badge to idle immediately.
					if err := client.Heartbeat(isAFK); err != nil {
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
				if err != nil {
					log.Printf("[config] FetchOrgConfig failed: %v", err)
					return
				}
				if newOrgCfg == nil {
					return
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

				// Stale screenshot janitor — delete orphan .jpg files older than
				// 7 days that have no matching row in the unsynced buffer. Protects
				// against disk fill if the agent was killed after os.Remove was
				// skipped (pre-deferred-delete behaviour) or after an external
				// cleanup tool touched the buffer. New captures are safe because
				// their mtime is recent.
				const staleAfter = 7 * 24 * time.Hour
				known := map[string]struct{}{}
				if rows, err := db.ListUnsyncedScreenshots(100_000); err == nil {
					for _, r := range rows {
						known[r.LocalPath] = struct{}{}
					}
				}
				entries, _ := os.ReadDir(screenshotsDir)
				var removed int
				now := time.Now()
				for _, ent := range entries {
					if ent.IsDir() {
						continue
					}
					name := ent.Name()
					if filepath.Ext(name) != ".jpg" {
						continue
					}
					full := filepath.Join(screenshotsDir, name)
					if _, ok := known[full]; ok {
						continue // still tracked — never delete
					}
					info, err := ent.Info()
					if err != nil {
						continue
					}
					if now.Sub(info.ModTime()) < staleAfter {
						continue // too fresh — might be mid-capture
					}
					if err := os.Remove(full); err == nil {
						removed++
					}
				}
				if removed > 0 {
					log.Printf("[janitor] removed %d stale screenshot file(s)", removed)
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

	// sem caps concurrent handler goroutines to 8 so a burst of browser
	// connections can't exhaust the goroutine pool.
	sem := make(chan struct{}, 8)
	for {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		select {
		case sem <- struct{}{}:
			go func(c net.Conn) {
				defer func() { <-sem }()
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
		default:
			log.Printf("[browser-urls] at capacity (8 connections) — rejecting")
			conn.Close()
		}
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
