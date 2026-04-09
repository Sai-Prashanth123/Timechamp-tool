// Package main is the TimeChamp Agent setup wizard.
// Opens a local browser page — no terminal, no dialogs, works on Windows/macOS/Linux.
// The agent binary is embedded at compile time; CI replaces agent_bin before building.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	agentsync "github.com/timechamp/agent/internal/sync"
)

//go:embed ui/index.html
var indexHTML []byte

//go:embed agent_bin
var agentBinary []byte

func main() {
	cfg := config.Load()

	// Bind on a random free port (keep listener open)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	done := make(chan struct{}, 1)

	mux := http.NewServeMux()

	// ── Serve setup page ────────────────────────────────────────────────────
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})

	// ── Ping: verify API is reachable ────────────────────────────────────────
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		apiURL := r.URL.Query().Get("apiUrl")
		if apiURL == "" {
			apiURL = cfg.APIURL
		}
		client := &http.Client{Timeout: 8 * time.Second}
		resp, err := client.Get(apiURL + "/health")
		if err != nil || resp.StatusCode >= 500 {
			jsonErr(w, "Cannot reach the API server. Check the URL and ensure it is running.", http.StatusServiceUnavailable)
			return
		}
		jsonOK(w, "ok")
	})

	// ── Register: authenticate + save credentials + launch agent ────────────
	mux.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var body struct {
			APIURL string `json:"apiUrl"`
			Token  string `json:"token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			jsonErr(w, "Invalid request body.", http.StatusBadRequest)
			return
		}
		if body.Token == "" {
			jsonErr(w, "Invite token is required.", http.StatusBadRequest)
			return
		}
		apiURL := body.APIURL
		if apiURL == "" {
			apiURL = cfg.APIURL
		}

		// Register device with API
		hostname, _ := os.Hostname()
		agentToken, employeeID, orgID, regErr := agentsync.Register(
			apiURL, body.Token, hostname, runtime.GOOS, runtime.GOARCH,
		)
		if regErr != nil {
			jsonErr(w, "Registration failed: "+regErr.Error(), http.StatusBadRequest)
			return
		}

		// Persist credentials
		if err := keychain.SaveToken(agentToken); err != nil {
			jsonErr(w, "Could not save token to keychain: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID); err != nil {
			jsonErr(w, "Could not save identity: "+err.Error(), http.StatusInternalServerError)
			return
		}

		// Extract embedded agent binary and launch it
		agentPath, extractErr := extractAgent(cfg.DataDir)
		if extractErr == nil {
			cmd := exec.Command(agentPath)
			cmd.Env = append(os.Environ(), "TC_API_URL="+apiURL)
			_ = cmd.Start()
		}

		jsonOK(w, "registered")

		// Shut down the HTTP server after the response is sent
		go func() {
			time.Sleep(200 * time.Millisecond)
			done <- struct{}{}
		}()
	})

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	// Open browser
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	openBrowser(url)

	// Block until registration completes
	<-done
	_ = srv.Close()
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, status string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	_ = cmd.Start()
}

// extractAgent writes the embedded agent binary to dataDir and returns the path.
func extractAgent(dataDir string) (string, error) {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return "", err
	}
	name := "timechamp-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dest := filepath.Join(dataDir, name)
	if err := os.WriteFile(dest, agentBinary, 0755); err != nil {
		return "", err
	}
	return dest, nil
}
