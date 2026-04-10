//go:build !windows && !darwin && !linux

package service

import "fmt"

type otherManager struct{}

func newManager() Manager { return &otherManager{} }

func (m *otherManager) Install(binaryPath string) error {
	return fmt.Errorf("service installation not supported on this platform; use a system init manager (systemd, etc.)")
}
func (m *otherManager) Uninstall() error    { return fmt.Errorf("not supported") }
func (m *otherManager) Start() error        { return fmt.Errorf("not supported") }
func (m *otherManager) Stop() error         { return fmt.Errorf("not supported") }
func (m *otherManager) Status() (string, error) { return "not supported", nil }

// IsWindowsService always returns false on non-Windows platforms.
func IsWindowsService() bool { return false }

// RunAsService is a no-op shim for non-Windows platforms.
func RunAsService(mainFn func()) error {
	mainFn()
	return nil
}
