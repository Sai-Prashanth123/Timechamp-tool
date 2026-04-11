package sync

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	stdsync "sync"
	"strings"
	"time"
)

type circuitState int

const (
	stateClosed   circuitState = 0
	stateOpen     circuitState = 1
	stateHalfOpen circuitState = 2
)

const (
	circuitOpenThreshold = 3                // consecutive failures before opening circuit
	circuitResetAfter    = 60 * time.Second // short enough for dev hot-reload, long enough to let a slow cold-start finish
)

// Client is an HTTP client for the TimeChamp API.
// It includes a thread-safe circuit breaker with half-open state and optional TLS certificate pinning.
type Client struct {
	baseURL     string
	token       string
	http        *http.Client
	retryConfig RetryConfig // defaults to DefaultRetry; overridable in tests

	mu            stdsync.Mutex
	state         circuitState  // guarded by mu
	failures      int           // guarded by mu
	openedAt      time.Time     // guarded by mu
	resetTimeout  time.Duration // guarded by mu; doubles on half-open probe failure
	probeInFlight bool          // guarded by mu; true when a half-open probe is in progress

	// pinnedCertSHA256 is the hex-encoded SHA-256 of the expected server certificate DER.
	// Empty string disables pinning.
	pinnedCertSHA256 string
}

// ClientOption configures a Client.
type ClientOption func(*Client)

// WithCertPin pins the TLS connection to a specific server certificate (SHA-256 of DER).
func WithCertPin(sha256Hex string) ClientOption {
	return func(c *Client) {
		c.pinnedCertSHA256 = sha256Hex
	}
}

// NewClient creates a new API client.
func NewClient(baseURL, token string, opts ...ClientOption) *Client {
	c := &Client{
		baseURL:      baseURL,
		token:        token,
		retryConfig:  DefaultRetry,
		resetTimeout: circuitResetAfter,
	}
	for _, opt := range opts {
		opt(c)
	}

	transport := &http.Transport{
		TLSHandshakeTimeout: 10 * time.Second,
	}

	if c.pinnedCertSHA256 != "" {
		transport.TLSClientConfig = &tls.Config{
			VerifyConnection: func(cs tls.ConnectionState) error {
				if len(cs.PeerCertificates) == 0 {
					return fmt.Errorf("tls pin: no peer certificates")
				}
				// Pin against the leaf certificate DER.
				leaf := cs.PeerCertificates[0]
				fingerprint := sha256.Sum256(leaf.Raw)
				got := hex.EncodeToString(fingerprint[:])
				if got != c.pinnedCertSHA256 {
					return fmt.Errorf("tls pin: cert fingerprint mismatch (got %s, want %s)", got, c.pinnedCertSHA256)
				}
				return nil
			},
		}
	}

	c.http = &http.Client{
		Timeout:   30 * time.Second,
		Transport: transport,
	}
	return c
}

// isBlocked returns true if the circuit is definitively open (not half-open).
// Used for mid-retry checks where we must not consume a half-open probe slot.
func (c *Client) isBlocked() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state != stateOpen {
		return false
	}
	return time.Since(c.openedAt) < c.resetTimeout
}

// IsAvailable returns true if the circuit is closed or transitioning to half-open (API reachable).
func (c *Client) IsAvailable() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	switch c.state {
	case stateClosed:
		return true
	case stateOpen:
		if time.Since(c.openedAt) >= c.resetTimeout {
			c.state = stateHalfOpen
			return true // allow probe
		}
		return false
	case stateHalfOpen:
		if c.probeInFlight {
			return false // probe already in flight — block all other callers
		}
		c.probeInFlight = true
		return true
	}
	return true
}

// Post sends a POST request with a JSON body using full-jitter exponential backoff.
func (c *Client) Post(path string, body any) error {
	if !c.IsAvailable() {
		return fmt.Errorf("circuit open: API unavailable")
	}

	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	return WithRetry(c.retryConfig, func() (permanent bool, err error) {
		// Re-check circuit breaker on each retry attempt (not first) — may have tripped during retries.
		// Use isBlocked() so we do not consume a half-open slot that was already granted above.
		if c.isBlocked() {
			return true, fmt.Errorf("circuit open: giving up after breaker tripped")
		}

		req, err := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(data))
		if err != nil {
			return true, fmt.Errorf("build request: %w", err) // permanent: bad request construction
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("X-Agent-Version", agentVersion)

		resp, err := c.http.Do(req)
		if err != nil {
			c.recordFailure()
			log.Printf("[sync] POST %s failed: %v", path, err)
			return false, fmt.Errorf("request failed: %w", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body) // drain body to allow connection reuse
		resp.Body.Close()

		if isPermanentHTTPStatus(resp.StatusCode) {
			// Release probe slot if in half-open — permanent errors (auth, not-found)
			// are not server availability signals; don't re-open the circuit.
			c.mu.Lock()
			if c.state == stateHalfOpen {
				c.probeInFlight = false
			}
			c.mu.Unlock()
			log.Printf("[sync] POST %s permanent error HTTP %d", path, resp.StatusCode)
			return true, fmt.Errorf("permanent HTTP %d for %s", resp.StatusCode, path)
		}
		if resp.StatusCode >= 400 {
			c.recordFailure()
			log.Printf("[sync] POST %s HTTP %d", path, resp.StatusCode)
			return false, fmt.Errorf("HTTP %d for %s", resp.StatusCode, path)
		}
		// Success
		c.recordSuccess()
		return false, nil
	})
}

// PutPresigned sends a PUT request to a presigned S3 URL with binary body.
func (c *Client) PutPresigned(url string, data []byte, contentType string) error {
	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("S3 upload failed: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("S3 upload status: %d", resp.StatusCode)
	}
	return nil
}

// GetPresignedUploadURL requests a presigned URL from the API for a screenshot upload.
// This method does NOT take a fresh probe slot via IsAvailable — the caller
// (FlushScreenshots) already gated the whole flush cycle with its own IsAvailable
// check, so taking another one here would leak the half-open probe slot when
// the inner check's `probeInFlight=true` causes this check to return false.
// Circuit state is still kept in sync via recordSuccess / recordFailure below.
func (c *Client) GetPresignedUploadURL(filename string) (uploadURL, s3Key string, err error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/agent/sync/screenshots/upload-url", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Agent-Version", agentVersion)

	q := req.URL.Query()
	q.Set("filename", filename)
	req.URL.RawQuery = q.Encode()

	resp, err := c.http.Do(req)
	if err != nil {
		c.recordFailure()
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url transport error: %v", err)
		return "", "", err
	}
	defer resp.Body.Close()

	if isPermanentHTTPStatus(resp.StatusCode) {
		// Auth / not-found errors — do not re-open the circuit; release probe slot.
		c.mu.Lock()
		if c.state == stateHalfOpen {
			c.probeInFlight = false
		}
		c.mu.Unlock()
		body, _ := io.ReadAll(resp.Body)
		bodyStr := strings.TrimSpace(string(body))
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url permanent HTTP %d: %s", resp.StatusCode, bodyStr)
		return "", "", fmt.Errorf("presign URL request failed (HTTP %d): %s", resp.StatusCode, bodyStr)
	}
	if resp.StatusCode != http.StatusOK {
		c.recordFailure()
		body, _ := io.ReadAll(resp.Body)
		bodyStr := strings.TrimSpace(string(body))
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url HTTP %d: %s", resp.StatusCode, bodyStr)
		return "", "", fmt.Errorf("presign URL request failed (HTTP %d): %s", resp.StatusCode, bodyStr)
	}

	// Read the full body first so we can log it if parsing fails or the URL is empty.
	bodyBytes, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		c.recordFailure()
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url read body error: %v", readErr)
		return "", "", readErr
	}

	var result struct {
		Data struct {
			UploadURL string `json:"uploadUrl"`
			S3Key     string `json:"s3Key"`
		} `json:"data"`
		// Legacy flat format (pre-`data:` wrapper fix) — fall back to this if present.
		UploadURL string `json:"uploadUrl"`
		S3Key     string `json:"s3Key"`
	}
	if err := json.Unmarshal(bodyBytes, &result); err != nil {
		c.recordFailure()
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url decode error: %v (body=%s)", err, strings.TrimSpace(string(bodyBytes)))
		return "", "", err
	}

	// Prefer the wrapped format, fall back to the flat format if the API is stale.
	uploadURL = result.Data.UploadURL
	s3Key = result.Data.S3Key
	if uploadURL == "" && result.UploadURL != "" {
		uploadURL = result.UploadURL
		s3Key = result.S3Key
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url — API returned flat format (needs restart to pick up data: wrapper)")
	}

	if uploadURL == "" {
		c.recordFailure()
		log.Printf("[sync] GET /agent/sync/screenshots/upload-url returned empty uploadUrl (body=%s)", strings.TrimSpace(string(bodyBytes)))
		return "", "", fmt.Errorf("presign URL response contained empty uploadUrl")
	}
	c.recordSuccess()
	return uploadURL, s3Key, nil
}

// PostBestEffort sends a single fire-and-forget POST that does NOT affect the
// circuit breaker and has no retries. Use for non-critical telemetry data where
// a timeout or transient error must not degrade core sync functionality.
func (c *Client) PostBestEffort(path string, body any) {
	data, err := json.Marshal(body)
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Agent-Version", agentVersion)

	resp, err := c.http.Do(req)
	if err != nil {
		return
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// SaveScreenshotMeta notifies the API of a completed screenshot upload.
func (c *Client) SaveScreenshotMeta(s3Key string, capturedAt time.Time, fileSizeBytes int64) error {
	body := map[string]any{
		"screenshotKey": s3Key,
		"capturedAt":    capturedAt.UTC().Format(time.RFC3339),
		"fileSizeBytes": fileSizeBytes,
	}
	return c.Post("/agent/sync/screenshots", body)
}

// Heartbeat pings the API to update last_seen_at for this device and
// reports the agent's current AFK (idle) state so the live-monitoring
// dashboard can transition users to the idle badge without waiting on
// activity-event frequency.
func (c *Client) Heartbeat(idle bool) error {
	return c.Post("/agent/sync/heartbeat", struct {
		Idle bool `json:"idle"`
	}{Idle: idle})
}

// OrgStreamConfig holds streaming configuration from the server.
type OrgStreamConfig struct {
	ScreenshotIntervalSec int  `json:"screenshotIntervalSec"`
	StreamingEnabled      bool `json:"streamingEnabled"`
	CameraEnabled         bool `json:"cameraEnabled"`
	AudioEnabled          bool `json:"audioEnabled"`
	MaxStreamFPS          int  `json:"maxStreamFps"`
}

// AgentCommands is the shape of the command-poll response.
// Used to receive out-of-band instructions from the API without requiring
// a persistent WebSocket connection. Polled every 2s by the agent.
type AgentCommands struct {
	// LiveView is true when a manager is actively watching this employee's
	// live screen feed. The agent enters burst-capture mode while this is
	// true and reverts to the normal screenshot interval when it goes false.
	LiveView bool `json:"liveView"`
}

// FetchCommands polls the API for out-of-band instructions.
// Intentionally bypasses the circuit breaker and uses a tight timeout so it
// never delays the main event loop even if the API is slow.
func (c *Client) FetchCommands() (*AgentCommands, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/agent/sync/commands", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Agent-Version", agentVersion)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("commands HTTP %d", resp.StatusCode)
	}

	var result struct {
		Data AgentCommands `json:"data"`
		// Fall back if the API ever drops the interceptor wrapper.
		LiveView bool `json:"liveView"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	cmds := result.Data
	if !cmds.LiveView && result.LiveView {
		cmds.LiveView = result.LiveView
	}
	return &cmds, nil
}

// FetchOrgConfig fetches organization config including streaming settings.
// Note: intentionally bypasses the circuit breaker — called on a slow polling
// interval and not on the hot-path.
func (c *Client) FetchOrgConfig() (*OrgStreamConfig, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+"/agent/sync/config", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-Agent-Version", agentVersion)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Data OrgStreamConfig `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result.Data, nil
}

func (c *Client) recordFailure() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.failures++
	if c.state == stateHalfOpen {
		// probe failed — double the timeout (cap at 1 hour)
		c.probeInFlight = false
		c.resetTimeout *= 2
		if c.resetTimeout > time.Hour {
			c.resetTimeout = time.Hour
		}
		c.state = stateOpen
		c.openedAt = time.Now()
		return
	}
	if c.failures >= circuitOpenThreshold {
		c.state = stateOpen
		c.openedAt = time.Now()
	}
}

func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.probeInFlight = false
	c.state = stateClosed
	c.failures = 0
	c.resetTimeout = circuitResetAfter // reset exponential backoff on recovery
}

// ResetCircuit clears an open circuit breaker so syncs can resume immediately
// after a system resume event. Pre-sleep failures are stale and should not
// block the first post-wake sync.
func (c *Client) ResetCircuit() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.probeInFlight = false
	c.state = stateClosed
	c.failures = 0
	c.resetTimeout = circuitResetAfter
}

// CircuitSnapshot is a read-only view of the breaker state for /health and tray.
type CircuitSnapshot struct {
	State        string        // "closed", "open", "half-open"
	Failures     int           // consecutive failures (0 when closed)
	OpenedAt     time.Time     // zero value if not currently open
	ResetTimeout time.Duration // current backoff window
}

// State returns a snapshot of the circuit breaker state. Safe to call from any goroutine.
func (c *Client) State() CircuitSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	var name string
	switch c.state {
	case stateClosed:
		name = "closed"
	case stateOpen:
		name = "open"
	case stateHalfOpen:
		name = "half-open"
	default:
		name = "unknown"
	}
	return CircuitSnapshot{
		State:        name,
		Failures:     c.failures,
		OpenedAt:     c.openedAt,
		ResetTimeout: c.resetTimeout,
	}
}

// agentVersion is embedded at build time via -ldflags "-X ...agentVersion=x.y.z".
var agentVersion = "dev"
