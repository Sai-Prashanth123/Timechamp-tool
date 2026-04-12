// Package main is the TimeChamp Agent setup wizard.
// Opens a local browser page — no terminal, no dialogs, works on Windows/macOS/Linux.
// The agent binary is embedded at compile time; CI replaces agent_bin before building.
//
// Windows UAC re-exec: when selfinstall needs admin to install a Windows Service,
// it re-launches this binary with --install-service <handoff-path>. The elevated
// process reads the handoff, installs the service, and exits immediately.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/timechamp/agent/internal/config"
	"github.com/timechamp/agent/internal/keychain"
	"github.com/timechamp/agent/internal/selfinstall"
	agentsync "github.com/timechamp/agent/internal/sync"
)

//go:embed ui/index.html
var indexHTML []byte

//go:embed agent_bin
var agentBinary []byte

func main() {
	// Windows UAC re-exec: install service from elevated process and exit.
	if len(os.Args) == 3 && os.Args[1] == "--install-service" {
		handleInstallService(os.Args[2])
		return
	}

	cfg := config.Load()

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
		if err != nil {
			jsonErr(w, "Cannot reach the API server. Check the URL and ensure it is running.", http.StatusServiceUnavailable)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 500 {
			jsonErr(w, "Cannot reach the API server. Check the URL and ensure it is running.", http.StatusServiceUnavailable)
			return
		}
		jsonOK(w, "ok")
	})

	// ── Register stream: SSE endpoint ────────────────────────────────────────
	mux.HandleFunc("/register-stream", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		apiURL := r.URL.Query().Get("apiUrl")
		if apiURL == "" {
			apiURL = cfg.APIURL
		}
		token := r.URL.Query().Get("token")
		displayName := r.URL.Query().Get("name")

		send := func(step, msg string) {
			data, _ := json.Marshal(map[string]string{"step": step, "msg": msg})
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}
		sendErr := func(step, errMsg string) {
			data, _ := json.Marshal(map[string]string{"step": step, "error": errMsg})
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		}

		// ── Step: connect ────────────────────────────────────────────────────
		send("connect", "Checking connection…")
		client := &http.Client{Timeout: 8 * time.Second}
		resp, pingErr := client.Get(apiURL + "/health")
		if pingErr != nil {
			sendErr("connect", fmt.Sprintf(
				"Cannot reach %s. Check the URL is correct and the server is running.", apiURL))
			return
		}
		resp.Body.Close() // always close; defer is not used in SSE handlers (long-lived goroutine)
		if resp.StatusCode >= 500 {
			sendErr("connect", fmt.Sprintf(
				"API server at %s returned status %d. Try again in a moment.", apiURL, resp.StatusCode))
			return
		}

		// ── Step: register ───────────────────────────────────────────────────
		// Use the new personal-token flow when the user entered a display
		// name (always, from the updated UI). Fallback to legacy invite-token
		// flow kept for any older frontends that don't send `name`.
		send("register", "Registering device…")
		hostname, _ := os.Hostname()
		var (
			agentToken string
			employeeID string
			orgID      string
			regErr     error
		)
		if displayName != "" {
			agentToken, employeeID, orgID, regErr = agentsync.RegisterWithPersonalToken(
				apiURL, token, displayName, hostname, runtime.GOOS, runtime.GOARCH,
			)
		} else {
			agentToken, employeeID, orgID, regErr = agentsync.Register(
				apiURL, token, hostname, runtime.GOOS, runtime.GOARCH,
			)
		}
		if regErr != nil {
			sendErr("register",
				"Token is invalid or has been rotated. Copy a fresh one from Dashboard → Settings → Agent Setup.")
			return
		}

		// ── Step: creds ──────────────────────────────────────────────────────
		send("creds", "Saving credentials…")
		if err := keychain.SaveToken(agentToken); err != nil {
			sendErr("creds",
				"Cannot save credentials to keychain. Check System Preferences → Privacy → Keychain.")
			return
		}
		if err := config.SaveIdentity(cfg.DataDir, orgID, employeeID, apiURL); err != nil {
			sendErr("creds",
				"Could not save identity. Check disk space and permissions in the data directory.")
			return
		}

		// ── Step: install ────────────────────────────────────────────────────
		send("install", "Installing agent…")
		progressCh := make(chan string, 16)
		go func() {
			for msg := range progressCh {
				send("install", msg)
			}
		}()

		result, installErr := selfinstall.Install(selfinstall.Config{
			BinaryData: agentBinary,
			APIURL:     apiURL,
			DataDir:    cfg.DataDir,
		}, progressCh)
		close(progressCh)

		if installErr != nil {
			msg := installErr.Error()
			switch {
			case containsAny(msg, "quarantine", "xattr"):
				sendErr("install",
					"Could not remove macOS security flag. Right-click the app and choose Open, then try again.")
			case containsAny(msg, "MDM_BLOCKED", "MDM-125"):
				sendErr("install",
					"Your organisation's IT policy is blocking background agents. Contact your IT admin and share error code: MDM-125.")
			case containsAny(msg, "registry Run key"):
				sendErr("install",
					"Could not configure auto-start. Run the setup as Administrator or contact IT.")
			case containsAny(msg, "health check"):
				sendErr("verify",
					"Agent did not start within 15 seconds. Check agent_error.log in the data directory for details.")
			default:
				sendErr("install", "Installation failed: "+msg)
			}
			return
		}

		// Emit non-fatal warnings (e.g. MDM fallback notice).
		for _, w := range result.Warnings {
			send("install", "⚠ "+w)
		}

		// ── Step: done ───────────────────────────────────────────────────────
		send("done", fmt.Sprintf(
			"Agent is running! Auto-start mode: %s. This window will close in 4 seconds.",
			result.AutoStartMode))

		go func() {
			time.Sleep(200 * time.Millisecond)
			done <- struct{}{}
		}()
	})

	srv := &http.Server{Handler: mux}
	go func() { _ = srv.Serve(ln) }()

	openBrowser(fmt.Sprintf("http://127.0.0.1:%d", port))
	<-done
	_ = srv.Close()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
