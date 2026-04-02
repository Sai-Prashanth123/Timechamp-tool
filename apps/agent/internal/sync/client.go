package sync

import (
	"bytes"
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

// Client is an HTTP client for the TimeChamp API with a simple circuit breaker.
type Client struct {
	baseURL     string
	token       string
	http        *http.Client
	failures    int
	openedAt    time.Time
	circuitOpen bool
}

// NewClient creates a new API client.
func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: baseURL,
		token:   token,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// IsAvailable returns true if the circuit is closed (API reachable).
func (c *Client) IsAvailable() bool {
	if !c.circuitOpen {
		return true
	}
	// Half-open: retry after reset window
	if time.Since(c.openedAt) > circuitResetAfter {
		c.circuitOpen = false
		c.failures = 0
		return true
	}
	return false
}

// Post sends a POST request with a JSON body to the given path.
func (c *Client) Post(path string, body any) error {
	if !c.IsAvailable() {
		return fmt.Errorf("circuit open: API unavailable, retry after %s",
			c.openedAt.Add(circuitResetAfter).Format(time.RFC3339))
	}

	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		c.recordFailure()
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) // drain body

	if resp.StatusCode >= 500 {
		c.recordFailure()
		return fmt.Errorf("server error: %d", resp.StatusCode)
	}

	// Success — reset failure count
	c.failures = 0
	c.circuitOpen = false
	return nil
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

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("S3 upload status: %d", resp.StatusCode)
	}
	return nil
}

// GetPresignedUploadURL requests a presigned URL from the API for a screenshot upload.
func (c *Client) GetPresignedUploadURL(filename string) (uploadURL, s3Key string, err error) {
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/agent/screenshots/presign", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

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
