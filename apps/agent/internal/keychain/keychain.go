package keychain

import (
	"fmt"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	service = "TimeChamp"
	account = "agent-token"
)

// SaveToken saves the API auth token to the OS keychain.
func SaveToken(token string) error {
	if err := keyring.Set(service, account, token); err != nil {
		return fmt.Errorf("save token to keychain: %w", err)
	}
	return nil
}

// LoadToken retrieves the API auth token from the OS keychain.
// Returns ("", nil) if no token is stored yet.
// Returns ("", nil) and logs if the stored value appears corrupted (e.g. NUL bytes,
// control characters, or suspiciously short — prevents silent auth failures).
func LoadToken() (string, error) {
	token, err := keyring.Get(service, account)
	if err == keyring.ErrNotFound {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load token from keychain: %w", err)
	}
	if !isPlausibleToken(token) {
		return "", fmt.Errorf("keychain token appears corrupted (len=%d); re-register the device", len(token))
	}
	return token, nil
}

// isPlausibleToken performs lightweight sanity checks on a stored token.
// A valid TimeChamp agent token is either a UUID (36 chars) or a JWT (≥64 chars,
// three dot-separated segments). Rejects empty strings, NUL bytes, and
// suspiciously short values that indicate keychain corruption.
func isPlausibleToken(t string) bool {
	if len(t) < 16 {
		return false // impossibly short
	}
	// Reject any control characters (NUL, SOH, etc.) — sign of corruption.
	for _, c := range t {
		if c < 0x20 && c != '\t' {
			return false
		}
	}
	// Accept UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx, 36 chars)
	if len(t) == 36 && strings.Count(t, "-") == 4 {
		return true
	}
	// Accept JWT format (header.payload.signature — 3 segments, ≥64 chars total)
	if len(t) >= 64 && strings.Count(t, ".") == 2 {
		return true
	}
	// Accept any opaque token ≥ 32 chars with no control chars (e.g. hex, base64)
	return len(t) >= 32
}

// DeleteToken removes the token from the OS keychain (used on uninstall).
func DeleteToken() error {
	err := keyring.Delete(service, account)
	if err == keyring.ErrNotFound {
		return nil // already gone
	}
	return err
}
