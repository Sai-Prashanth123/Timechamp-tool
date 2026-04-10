//go:build windows

package main

import (
	"log"

	"github.com/timechamp/agent/internal/selfinstall"
)

// handleInstallService is called when the binary is re-launched elevated via UAC.
// It reads the handoff file, installs the Windows Service, and returns.
// The non-elevated parent process polls for the service to appear.
func handleInstallService(handoffPath string) {
	binaryPath, err := selfinstall.ReadHandoff(handoffPath)
	if err != nil {
		log.Printf("install-service: read handoff: %v", err)
		return
	}
	if err := selfinstall.DoInstallService(binaryPath); err != nil {
		log.Printf("install-service: %v", err)
	}
}
