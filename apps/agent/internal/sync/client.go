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
	circuitOpenThreshold = 3 // consecutive failures before opening circuit
	circuitResetAfter    = 5 * time.Minute
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
		baseURL:     baseURL,
		token:       token,
		retryConfig: DefaultRetry,
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
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("S3 upload status: %d", resp.StatusCode)
	}
	return nil
}

// GetPresignedUploadURL requests a presigned URL from the API for a screenshot upload.
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
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("presign URL request failed (HTTP %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var result struct {
		Data struct {
			UploadURL string `json:"uploadUrl"`
			S3Key     string `json:"s3Key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	if result.Data.UploadURL == "" {
		return "", "", fmt.Errorf("presign URL response contained empty uploadUrl")
	}
	return result.Data.UploadURL, result.Data.S3Key, nil
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

// Heartbeat pings the API to update last_seen_at for this device.
func (c *Client) Heartbeat() error {
	return c.Post("/agent/sync/heartbeat", struct{}{})
}

// OrgStreamConfig holds streaming configuration from the server.
type OrgStreamConfig struct {
	ScreenshotIntervalSec int  `json:"screenshotIntervalSec"`
	StreamingEnabled      bool `json:"streamingEnabled"`
	CameraEnabled         bool `json:"cameraEnabled"`
	AudioEnabled          bool `json:"audioEnabled"`
	MaxStreamFPS          int  `json:"maxStreamFps"`
}

// FetchOrgConfig fetches organization config including streaming settings.
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
		if c.resetTimeout == 0 {
			c.resetTimeout = circuitResetAfter
		}
	}
}

func (c *Client) recordSuccess() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.probeInFlight = false
	c.state = stateClosed
	c.failures = 0
	c.resetTimeout = circuitResetAfter // reset backoff
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

// agentVersion is embedded at build time via -ldflags "-X ...agentVersion=x.y.z".
var agentVersion = "dev"
