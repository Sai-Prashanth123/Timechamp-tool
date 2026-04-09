//go:build windows

// Package main is the TimeChamp Agent desktop tray application.
// Built with Wails v2 — renders a native OS window (no browser) using the
// platform's built-in webview (WebView2/WKWebView/WebKitGTK).
// On first launch the Setup wizard appears; after registration the window
// hides to the system tray and the background agent runs automatically.
package main

import (
	"embed"

	"github.com/energye/systray"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed agent_bin
var agentBinary []byte

func main() {
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
