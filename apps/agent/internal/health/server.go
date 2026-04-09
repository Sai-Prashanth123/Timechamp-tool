// apps/agent/internal/health/server.go
package health

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

const Addr = "127.0.0.1:27183"

// Metrics holds live agent health state pushed from the main loop after each sync.
type Metrics struct {
	BufferDepth        int
	SyncHealthy        bool
	LastSyncAt         time.Time
	HasScreenRecording bool
	HasAccessibility   bool
	URLDetectionLayer  int32
}

// Server exposes a local HTTP /health endpoint for liveness checks.
type Server struct {
	startedAt time.Time
	version   string
	server    *http.Server

	mu      sync.RWMutex
	metrics Metrics
}

// Response is the JSON shape returned by /health.
type Response struct {
	Status             string    `json:"status"`
	Uptime             int64     `json:"uptime_sec"`
	Version            string    `json:"version"`
	BufferDepth        int       `json:"buffer_depth"`
	SyncHealthy        bool      `json:"sync_healthy"`
	LastSyncAt         time.Time `json:"last_sync_at,omitempty"`
	HasScreenRecording bool      `json:"has_screen_recording"`
	HasAccessibility   bool      `json:"has_accessibility"`
	URLDetectionLayer  int32     `json:"url_detection_layer"`
}

func New(version string) *Server {
	s := &Server{
		startedAt: time.Now(),
		version:   version,
		// Assume healthy defaults until first sync updates these.
		metrics: Metrics{SyncHealthy: true, HasScreenRecording: true, HasAccessibility: true},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", s.handleHealth)
	s.server = &http.Server{
		Addr:         Addr,
		Handler:      mux,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
	}
	return s
}

// SetMetrics updates the live agent health state. Thread-safe; call from main loop.
func (s *Server) SetMetrics(m Metrics) {
	s.mu.Lock()
	s.metrics = m
	s.mu.Unlock()
}

func (s *Server) Start() {
	go func() {
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("health server: %v (port 27183 may already be in use)", err)
		}
	}()
}

func (s *Server) Stop(ctx context.Context) {
	_ = s.server.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	m := s.metrics
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Status:             "ok",
		Uptime:             int64(time.Since(s.startedAt).Seconds()),
		Version:            s.version,
		BufferDepth:        m.BufferDepth,
		SyncHealthy:        m.SyncHealthy,
		LastSyncAt:         m.LastSyncAt,
		HasScreenRecording: m.HasScreenRecording,
		HasAccessibility:   m.HasAccessibility,
		URLDetectionLayer:  m.URLDetectionLayer,
	})
}
