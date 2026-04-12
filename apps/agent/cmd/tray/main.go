//go:build windows

// Package main is the TimeChamp Agent desktop tray application.
// Built with Wails v2 — renders a native OS window (no browser) using the
// platform's built-in webview (WebView2/WKWebView/WebKitGTK).
// On first launch the Setup wizard appears; after registration the window
// hides to the system tray and the background agent runs automatically.
package main

import (
	"embed"
	"os"
	"syscall"
	"unsafe"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed agent_bin.exe
var agentBinary []byte

// singleInstance creates a named Windows mutex. Returns the handle (must stay
// open for the lifetime of the process) and whether this is the first instance.
func singleInstance() (syscall.Handle, bool) {
	name, _ := syscall.UTF16PtrFromString("Local\\TimechampTrayApp")
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	h, _, err := kernel32.NewProc("CreateMutexW").Call(
		0,
		1,
		uintptr(unsafe.Pointer(name)),
	)
	if h == 0 {
		return 0, false
	}
	// ERROR_ALREADY_EXISTS (183) means another instance owns the mutex.
	alreadyExists := err.(syscall.Errno) == 183
	return syscall.Handle(h), !alreadyExists
}

func main() {
	_, first := singleInstance()
	if !first {
		// Another instance is already running — exit silently.
		os.Exit(0)
	}

	// R6.1: Self-register in HKCU\Software\Microsoft\Windows\CurrentVersion\Run
	// so the tray auto-launches at every user login. Idempotent — costs ~1ms
	// on subsequent launches when the entry is already correct. Failures are
	// logged but never block startup; auto-start is a convenience feature.
	ensureAutoStart()

	// R6.4: Belt-and-braces Task Scheduler entry with two extra triggers that
	// HKCU Run can't express:
	//   - SessionUnlock (catches wake-from-sleep + manual unlock)
	//   - RestartOnFailure (relaunches the tray if it crashes mid-session)
	// Per-user task — no UAC. Idempotent. Failures non-fatal.
	ensureScheduledTask()

	app := NewApp(agentBinary)

	// System tray runs in its own goroutine — energye/systray is safe to call
	// from a goroutine on all platforms (including macOS).
	go systray.Run(app.onTrayReady, app.onTrayExit)

	err := wails.Run(&options.App{
		Title:             "TimeChamp Agent",
		Width:             440,
		Height:            540,
		DisableResize:     true,
		StartHidden:       false,
		HideWindowOnClose: true,
		BackgroundColour:  &options.RGBA{R: 15, G: 23, B: 42, A: 255},
		AssetServer:       &assetserver.Options{Assets: assets},
		OnStartup:         app.startup,
		Bind:              []interface{}{app},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
	if err != nil {
		println("Wails error:", err.Error())
	}
}
