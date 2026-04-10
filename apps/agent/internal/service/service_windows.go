//go:build windows

package service

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	serviceName        = "TimeChampAgent"
	serviceDisplayName = "Time Champ Agent"
	serviceDescription = "Time Champ productivity monitoring agent"

	pbtApmSuspend         uint32 = 0x0004 // PBT_APMSUSPEND
	pbtApmResumeAutomatic uint32 = 0x0012 // PBT_APMRESUMEAUTOMATIC
)

// PowerEvents receives "suspend" and "resume" strings from the Windows SCM
// power event callback. Buffer 4 to avoid blocking the service handler.
// main.go reads this channel and forwards events to sleepwatch.Signal().
// Only populated when running as a Windows Service (not when tray-launched).
// WARNING: caller must drain this channel; buffer holds only 4 events before drops begin.
var PowerEvents = make(chan string, 4)

type windowsManager struct{}

func newManager() Manager { return &windowsManager{} }

// Install registers the agent as a Windows Service with automatic start and
// three failure recovery actions (restart after 1 s, 5 s, 30 s).
func (m *windowsManager) Install(binaryPath string) error {
	absPath, err := filepath.Abs(binaryPath)
	if err != nil {
		return err
	}

	sm, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to SCM: %w", err)
	}
	defer sm.Disconnect()

	// Check for existing service.
	existing, err := sm.OpenService(serviceName)
	if err == nil {
		existing.Close()
		return fmt.Errorf("service %q already exists; run uninstall first", serviceName)
	}

	config := mgr.Config{
		StartType:        mgr.StartAutomatic,
		DisplayName:      serviceDisplayName,
		Description:      serviceDescription,
		BinaryPathName:   absPath,
		ServiceStartName: "LocalSystem", // run as SYSTEM
	}

	svc, err := sm.CreateService(serviceName, absPath, config)
	if err != nil {
		return fmt.Errorf("create service: %w", err)
	}
	defer svc.Close()

	// Set failure recovery: restart after 1s, 5s, 30s.
	if err := setFailureActions(svc); err != nil {
		return fmt.Errorf("set failure actions: %w", err)
	}

	fmt.Printf("Service %q installed. Run 'sc start %s' or reboot to activate.\n",
		serviceName, serviceName)
	return nil
}

// Uninstall removes the Windows Service.
func (m *windowsManager) Uninstall() error {
	sm, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("connect to SCM: %w", err)
	}
	defer sm.Disconnect()

	s, err := sm.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("open service: %w", err)
	}
	defer s.Close()

	// Stop first if running.
	_ = stopService(s)

	return s.Delete()
}

// Start starts the Windows Service immediately.
func (m *windowsManager) Start() error {
	sm, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer sm.Disconnect()

	s, err := sm.OpenService(serviceName)
	if err != nil {
		return err
	}
	defer s.Close()

	return s.Start()
}

// Stop sends a stop control to the Windows Service.
func (m *windowsManager) Stop() error {
	sm, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer sm.Disconnect()

	s, err := sm.OpenService(serviceName)
	if err != nil {
		return err
	}
	defer s.Close()

	return stopService(s)
}

// Status returns the current service state string.
func (m *windowsManager) Status() (string, error) {
	sm, err := mgr.Connect()
	if err != nil {
		return "not installed", nil
	}
	defer sm.Disconnect()

	s, err := sm.OpenService(serviceName)
	if err != nil {
		return "not installed", nil
	}
	defer s.Close()

	q, err := s.Query()
	if err != nil {
		return "", err
	}
	switch q.State {
	case svc.Running:
		return "running", nil
	case svc.Stopped:
		return "stopped", nil
	default:
		return fmt.Sprintf("state=%d", q.State), nil
	}
}

// RunAsService is called when the binary is launched by the SCM.
// It wraps the mainFn in the Windows service protocol handshake.
func RunAsService(mainFn func()) error {
	return svc.Run(serviceName, &agentSvc{mainFn: mainFn})
}

// IsWindowsService returns true when the process was started by the SCM.
func IsWindowsService() bool {
	ok, _ := svc.IsWindowsService()
	return ok
}

// agentSvc implements the svc.Handler interface.
type agentSvc struct {
	mainFn func()
}

func (a *agentSvc) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown | svc.AcceptPowerEvent

	changes <- svc.Status{State: svc.StartPending}

	done := make(chan struct{})
	go func() {
		a.mainFn()
		close(done)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				// Give mainFn up to 10 s to finish.
				select {
				case <-done:
				case <-time.After(10 * time.Second):
				}
				return false, 0
			case svc.PowerEvent:
				switch c.EventType {
				case pbtApmResumeAutomatic:
					select {
					case PowerEvents <- "resume":
					default:
					}
				case pbtApmSuspend:
					select {
					case PowerEvents <- "suspend":
					default:
					}
				}
			}
		case <-done:
			changes <- svc.Status{State: svc.StopPending}
			return false, 0
		}
	}
}

// --- helpers ----------------------------------------------------------------

func stopService(s *mgr.Service) error {
	_, err := s.Control(svc.Stop)
	return err
}

// SERVICE_FAILURE_ACTIONS structures for SetServiceRecovery.
type serviceFailureActions struct {
	dwResetPeriod uint32
	lpRebootMsg   *uint16
	lpCommand     *uint16
	cActions      uint32
	lpsaActions   uintptr
}

type scAction struct {
	actionType uint32 // SC_ACTION_RESTART = 1
	delay      uint32 // milliseconds
}

const scActionRestart = 1

// registerEventSource adds the agent binary as an event source in the Windows
// Event Log so that log entries appear in Event Viewer. Requires admin rights.
func registerEventSource() error {
	exePath, err := os.Executable()
	if err != nil {
		return err
	}

	advapi32 := windows.NewLazySystemDLL("advapi32.dll")
	registerEventSourceProc := advapi32.NewProc("RegisterEventSourceW")
	exePtr, _ := windows.UTF16PtrFromString(exePath)
	svcPtr, _ := windows.UTF16PtrFromString(serviceName)
	handle, _, callErr := registerEventSourceProc.Call(0, uintptr(unsafe.Pointer(svcPtr)))
	if handle == 0 {
		return fmt.Errorf("RegisterEventSource: %w", callErr)
	}
	_ = exePtr
	deregister := advapi32.NewProc("DeregisterEventSource")
	deregister.Call(handle)
	return nil
}

func setFailureActions(s *mgr.Service) error {
	actions := []scAction{
		{scActionRestart, 1000},  // first failure: restart after 1s
		{scActionRestart, 5000},  // second failure: restart after 5s
		{scActionRestart, 30000}, // subsequent: restart after 30s
	}

	sfa := serviceFailureActions{
		dwResetPeriod: 86400, // reset failure count after 24h
		cActions:      uint32(len(actions)),
		lpsaActions:   uintptr(unsafe.Pointer(&actions[0])),
	}

	advapi32 := windows.NewLazySystemDLL("advapi32.dll")
	changeServiceConfig2 := advapi32.NewProc("ChangeServiceConfig2W")

	const serviceConfigFailureActions = 2
	r1, _, err := changeServiceConfig2.Call(
		uintptr(s.Handle),
		serviceConfigFailureActions,
		uintptr(unsafe.Pointer(&sfa)),
	)
	if r1 == 0 {
		return fmt.Errorf("ChangeServiceConfig2: %w", err)
	}

	// Best-effort: register event source for Windows Event Log.
	// Errors are ignored — this is cosmetic only.
	_ = registerEventSource()

	return nil
}
