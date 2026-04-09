package sync

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	circuitOpenThreshold = 3 // consecutive failures before opening circuit
	circuitResetAfter    = 5 * time.Minute
)

// Client is an HTTP client for the TimeChamp API.
// It includes a simple circuit breaker and optional TLS certificate pinning.
type Client struct {
	baseURL     string
	token       string
	http        *http.Client
	failures    int
	openedAt    time.Time
	circuitOpen bool
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
		baseURL: baseURL,
		token:   token,
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

// IsAvailable returns true if the circuit is closed (API reachable).
func (c *Client) IsAvailable() bool {
	if !c.circuitOpen {
		return true
	}
	if time.Since(c.openedAt) > circuitResetAfter {
		c.circuitOpen = false
		c.failures = 0
		return true
	}
	return false
}

// Post sends a POST request with a JSON body using full-jitter exponential backoff.
func (c *Client) Post(path string, body any) error {
	if !c.IsAvailable() {
		return fmt.Errorf("circuit open: API unavailable, retry after %s",
			c.openedAt.Add(circuitResetAfter).Format(time.RFC3339))
	}

	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	return WithRetry(DefaultRetry, func() (permanent bool, err error) {
		// Re-check circuit breaker on each attempt — may have tripped during retries.
		if !c.IsAvailable() {
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
			return false, fmt.Errorf("request failed: %w", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body) // drain body to allow connection reuse
		resp.Body.Close()

		if isPermanentHTTPStatus(resp.StatusCode) {
			return true, fmt.Errorf("permanent HTTP %d for %s", resp.StatusCode, path)
		}
		if resp.StatusCode >= 400 {
			c.recordFailure()
			return false, fmt.Errorf("HTTP %d for %s", resp.StatusCode, path)
		}
		// Success
		c.failures = 0
		c.circuitOpen = false
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

	var result struct {
		Data struct {
			UploadURL string `json:"uploadUrl"`
			S3Key     string `json:"s3Key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	return result.Data.UploadURL, result.Data.S3Key, nil
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
	c.failures++
	if c.failures >= circuitOpenThreshold {
		c.circuitOpen = true
		c.openedAt = time.Now()
	}
}

// agentVersion is embedded at build time via -ldflags "-X ...agentVersion=x.y.z".
var agentVersion = "dev"
