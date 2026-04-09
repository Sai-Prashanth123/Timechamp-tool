package capture_test

import (
	"testing"

	"github.com/timechamp/agent/internal/capture"
)

func TestExtractURLFromTitle(t *testing.T) {
	cases := []struct{ title, expected string }{
		{"GitHub - microsoft/vscode - Google Chrome", "github.com"},
		{"YouTube - Mozilla Firefox", "youtube.com"},
		{"New Tab - Google Chrome", ""},
		{"notion.so - Workspace - Brave", "notion.so"},
		{"Gmail - Google Chrome", "mail.google.com"},
	}
	for _, c := range cases {
		got := capture.ExtractURLFromTitle(c.title)
		if got != c.expected {
			t.Errorf("title=%q: got %q, want %q", c.title, got, c.expected)
		}
	}
}

func TestIsBrowser(t *testing.T) {
	cases := []struct {
		win      capture.ActiveWindow
		expected bool
	}{
		{capture.ActiveWindow{AppName: "Google Chrome"}, true},
		{capture.ActiveWindow{BundleID: "com.apple.Safari"}, true},
		{capture.ActiveWindow{AppName: "Visual Studio Code"}, false},
		{capture.ActiveWindow{AppName: "firefox.exe"}, true},
	}
	for _, c := range cases {
		got := capture.IsBrowser(c.win)
		if got != c.expected {
			t.Errorf("win=%+v: got %v, want %v", c.win, got, c.expected)
		}
	}
}

func TestResolveURL_LayerPriority(t *testing.T) {
	browser := capture.ActiveWindow{AppName: "Google Chrome", URL: "https://native.example.com"}
	if got := capture.ResolveURL(browser, "https://ext.example.com"); got != "https://ext.example.com" {
		t.Errorf("layer1: got %q", got)
	}
	if got := capture.ResolveURL(browser, ""); got != "https://native.example.com" {
		t.Errorf("layer2: got %q", got)
	}
	nonBrowser := capture.ActiveWindow{AppName: "Visual Studio Code"}
	if got := capture.ResolveURL(nonBrowser, "https://anything.com"); got != "" {
		t.Errorf("non-browser: got %q", got)
	}
}
