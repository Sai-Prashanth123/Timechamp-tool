// apps/agent/internal/health/server.go
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

const Addr = "127.0.0.1:27183"

type Server struct {
	startedAt time.Time
	version   string
	server    *http.Server
}

type Response struct {
	Status  string `json:"status"`
	Uptime  int64  `json:"uptime_sec"`
	Version string `json:"version"`
}

func New(version string) *Server {
	s := &Server{startedAt: time.Now(), version: version}
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

func (s *Server) Start() {
	go func() {
		_ = s.server.ListenAndServe()
	}()
}

func (s *Server) Stop(ctx context.Context) {
	_ = s.server.Shutdown(ctx)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Status:  "ok",
		Uptime:  int64(time.Since(s.startedAt).Seconds()),
		Version: s.version,
	})
}
