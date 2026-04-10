//go:build !windows

package main

// handleInstallService is a no-op on non-Windows platforms.
// The --install-service flag is only passed on Windows (UAC re-exec path).
func handleInstallService(_ string) {}
