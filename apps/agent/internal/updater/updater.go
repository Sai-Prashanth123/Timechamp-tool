// Package updater checks for and applies agent self-updates from GitHub Releases.
// Update binaries must be signed with ECDSA-P256; the public key is embedded at
// build time. The update flow is:
//
//  1. Fetch latest release metadata from the GitHub API.
//  2. Compare version tag against current agentVersion.
//  3. Download the platform-specific asset and its .sig file.
//  4. Verify ECDSA-P256 signature (SHA-256 of the binary payload).
//  5. Replace the current executable atomically then re-exec.
package updater

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Config controls the update check behaviour.
type Config struct {
	// CurrentVersion is the running agent version (e.g. "1.2.3").
	CurrentVersion string
	// Repo is the GitHub "owner/repo" slug (e.g. "timechamp/agent").
	Repo string
	// PublicKeyPEM is the PEM-encoded ECDSA-P256 public key used to verify assets.
	PublicKeyPEM string
	// DataDir is where the downloaded asset is staged before replacement.
	DataDir string
}

// CheckAndApply checks GitHub Releases for a newer version and, if found and
// the signature is valid, replaces the current binary and re-executes.
// It is safe to call from a background goroutine; it never panics.
func CheckAndApply(cfg Config) error {
	latest, assetURL, sigURL, err := fetchLatestRelease(cfg.Repo, cfg.CurrentVersion)
	if err != nil {
		return fmt.Errorf("update check: %w", err)
	}
	if latest == "" {
		return nil // already up-to-date
	}

	// Download asset and signature concurrently.
	assetBytes, err := httpGet(assetURL)
	if err != nil {
		return fmt.Errorf("download asset: %w", err)
	}
	sigHex, err := httpGet(sigURL)
	if err != nil {
		return fmt.Errorf("download sig: %w", err)
	}

	// Verify signature.
	if err := verifyECDSA(cfg.PublicKeyPEM, assetBytes, strings.TrimSpace(string(sigHex))); err != nil {
		return fmt.Errorf("signature verification failed: %w", err)
	}

	// Stage the new binary next to the current executable.
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return fmt.Errorf("resolve symlinks: %w", err)
	}

	stagePath := exe + ".update"
	if err := os.WriteFile(stagePath, assetBytes, 0755); err != nil {
		return fmt.Errorf("write staged binary: %w", err)
	}

	// Atomic replace: rename staged file over current binary.
	// On Windows this requires the process not holding the file open — the
	// watchdog will restart the agent after it exits.
	backupPath := exe + ".bak"
	if err := os.Rename(exe, backupPath); err != nil {
		os.Remove(stagePath)
		return fmt.Errorf("backup current binary: %w", err)
	}
	if err := os.Rename(stagePath, exe); err != nil {
		// Rollback
		os.Rename(backupPath, exe)
		return fmt.Errorf("install new binary: %w", err)
	}
	os.Remove(backupPath)

	fmt.Printf("[updater] updated to %s — exiting for restart\n", latest)
	os.Exit(0) // watchdog / service manager will restart us
	return nil
}

// releaseAsset holds the fields we need from a GitHub release asset.
type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// githubRelease is a minimal subset of the GitHub Releases API response.
type githubRelease struct {
	TagName string         `json:"tag_name"`
	Assets  []releaseAsset `json:"assets"`
}

// fetchLatestRelease returns the tag, asset URL, and signature URL if a newer
// version is available, or empty strings if already up-to-date.
func fetchLatestRelease(repo, currentVersion string) (tag, assetURL, sigURL string, err error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", repo)

	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, apiURL, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", err
	}
	defer resp.Body.Close()

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", "", "", err
	}

	latestTag := strings.TrimPrefix(rel.TagName, "v")
	currentTag := strings.TrimPrefix(currentVersion, "v")
	if latestTag == currentTag || latestTag == "" {
		return "", "", "", nil // up-to-date
	}

	// Determine the expected asset name for this OS/arch.
	// Convention: timechamp-agent-<os>-<arch>[.exe]
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	wantName := fmt.Sprintf("timechamp-agent-%s-%s%s", runtime.GOOS, runtime.GOARCH, suffix)

	for _, a := range rel.Assets {
		if a.Name == wantName {
			assetURL = a.BrowserDownloadURL
		}
		if a.Name == wantName+".sig" {
			sigURL = a.BrowserDownloadURL
		}
	}

	if assetURL == "" || sigURL == "" {
		return "", "", "", fmt.Errorf("no asset found for %s/%s in release %s", runtime.GOOS, runtime.GOARCH, rel.TagName)
	}

	return latestTag, assetURL, sigURL, nil
}

// httpGet performs a simple GET and returns the response body.
func httpGet(url string) ([]byte, error) {
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, url)
	}
	return io.ReadAll(resp.Body)
}

// verifyECDSA verifies an ECDSA-P256 signature over the SHA-256 of data.
// sigHex is the hex-encoded "r||s" (each 32 bytes, big-endian).
func verifyECDSA(publicKeyPEM string, data []byte, sigHex string) error {
	block, _ := pem.Decode([]byte(publicKeyPEM))
	if block == nil {
		return fmt.Errorf("invalid PEM block")
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("parse public key: %w", err)
	}
	ecPub, ok := pub.(*ecdsa.PublicKey)
	if !ok || ecPub.Curve != elliptic.P256() {
		return fmt.Errorf("expected ECDSA-P256 public key")
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return fmt.Errorf("decode signature hex: %w", err)
	}
	if len(sigBytes) != 64 {
		return fmt.Errorf("signature must be 64 bytes (r||s), got %d", len(sigBytes))
	}

	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])

	digest := sha256.Sum256(data)
	if !ecdsa.Verify(ecPub, digest[:], r, s) {
		return fmt.Errorf("signature does not match")
	}
	return nil
}
