package stream

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/timechamp/agent/internal/capture"
)

// StreamMode represents the streaming mode.
type StreamMode string

const (
	ModeIdle StreamMode = "idle"
	ModeGrid StreamMode = "grid"
	ModeFull StreamMode = "full"
)

// Config holds streaming configuration.
type Config struct {
	Enabled       bool
	CameraEnabled bool
	AudioEnabled  bool
	MaxFPS        int
	WSURL         string
	AgentToken    string
}

// Manager orchestrates screen, camera, and audio streaming.
type Manager struct {
	cfg    Config
	client *StreamClient
	delta  *DeltaEncoder
	mode   StreamMode
	mu     sync.RWMutex
	stopCh chan struct{}
}

// NewManager creates a new streaming Manager.
func NewManager(cfg Config) *Manager {
	return &Manager{
		cfg:    cfg,
		client: NewStreamClient(cfg.WSURL, cfg.AgentToken),
		delta:  NewDeltaEncoder(),
		mode:   ModeIdle,
		stopCh: make(chan struct{}),
	}
}

// Start begins the streaming goroutine.
func (m *Manager) Start() {
	go m.run()
}

// Stop gracefully stops streaming.
func (m *Manager) Stop() {
	close(m.stopCh)
	m.client.Disconnect()
}

// SetMode updates the streaming mode (called from control frame handler).
func (m *Manager) SetMode(mode StreamMode) {
	m.mu.Lock()
	m.mode = mode
	m.mu.Unlock()
}

func (m *Manager) currentMode() StreamMode {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.mode
}

func (m *Manager) run() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect with retry
	if err := m.client.ConnectWithRetry(ctx); err != nil {
		return
	}

	// Listen for control frames
	go m.handleControlFrames(ctx)

	heartbeat := time.NewTicker(30 * time.Second)
	defer heartbeat.Stop()

	screenTicker := time.NewTicker(time.Second) // 1 FPS base; mode governs whether we skip
	defer screenTicker.Stop()

	cameraTicker := time.NewTicker(time.Second)
	defer cameraTicker.Stop()

	audioTicker := time.NewTicker(time.Second)
	defer audioTicker.Stop()

	for {
		select {
		case <-m.stopCh:
			return

		case <-heartbeat.C:
			// Check heartbeat ACK timeout before sending next ping.
			if m.client.TimeSinceLastAck() > 65*time.Second {
				log.Printf("[stream] heartbeat ACK timeout (>65s), reconnecting")
				// Close the underlying connection without signalling done,
				// then reconnect with retry.
				m.client.closeConn("heartbeat timeout")
				if err := m.client.ConnectWithRetry(ctx); err != nil {
					log.Printf("[stream] reconnect failed: %v", err)
					return
				}
				go m.handleControlFrames(ctx)
			}
			_ = m.client.SendFrame(ctx, BuildHeartbeatFrame())

		case <-screenTicker.C:
			mode := m.currentMode()
			if mode == ModeIdle {
				continue
			}
			quality := 40
			if mode == ModeFull {
				quality = 60
			}
			img, err := capture.CaptureScreenImage()
			if err != nil {
				log.Printf("[stream] screen capture error: %v", err)
				continue
			}
			frameType, data, err := m.delta.Encode(img, quality)
			if err != nil {
				continue
			}
			_ = m.client.SendFrame(ctx, BuildFrame(frameType, data))

		case <-cameraTicker.C:
			mode := m.currentMode()
			if mode != ModeFull || !m.cfg.CameraEnabled {
				continue
			}
			data, err := capture.CaptureCamera()
			if err != nil {
				continue // non-fatal
			}
			_ = m.client.SendFrame(ctx, BuildFrame(FrameTypeCamera, data))

		case <-audioTicker.C:
			mode := m.currentMode()
			if mode != ModeFull || !m.cfg.AudioEnabled {
				continue
			}
			data, err := capture.CaptureAudioChunk()
			if err != nil {
				continue // non-fatal
			}
			_ = m.client.SendFrame(ctx, BuildFrame(FrameTypeAudio, data))
		}
	}
}

func (m *Manager) handleControlFrames(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case payload := <-m.client.ControlFrames():
			var cmd map[string]any
			if err := json.Unmarshal(payload, &cmd); err != nil {
				continue
			}
			action, _ := cmd["action"].(string)
			switch action {
			case "start_stream", "start_full":
				m.SetMode(ModeFull)
			case "stop_stream", "stop_streaming", "session_timeout", "bandwidth_cap_exceeded":
				m.SetMode(ModeIdle)
			case "start_grid":
				m.SetMode(ModeGrid)
			case "set_mode":
				if modeVal, ok := cmd["mode"].(string); ok && modeVal != "" {
					m.SetMode(StreamMode(modeVal))
				}
			case "reduce_fps":
				// Switch to grid mode (1 FPS) to reduce bandwidth
				m.SetMode(ModeGrid)
			}
		}
	}
}
