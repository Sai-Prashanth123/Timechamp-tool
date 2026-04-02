package keychain

import (
	"fmt"

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
func LoadToken() (string, error) {
	token, err := keyring.Get(service, account)
	if err == keyring.ErrNotFound {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("load token from keychain: %w", err)
	}
	return token, nil
}

// DeleteToken removes the token from the OS keychain (used on uninstall).
func DeleteToken() error {
	err := keyring.Delete(service, account)
	if err == keyring.ErrNotFound {
		return nil // already gone
	}
	return err
}
