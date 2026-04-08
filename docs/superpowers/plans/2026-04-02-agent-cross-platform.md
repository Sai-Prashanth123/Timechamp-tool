# Plan: Agent macOS + Linux Cross-Platform Support

**Date:** 2026-04-02  
**Sub-project:** 9 — Agent macOS + Linux  
**Status:** Executing

---

## Context

The Go desktop agent at `apps/agent/` already has a three-platform skeleton:

- `internal/platform/` — data directory location — fully implemented for all three OSes
- `internal/capture/activity_*.go` — active window — Windows is full, macOS/Linux are stubs
- `internal/capture/idle_*.go` — idle detection — Windows is full, macOS/Linux are stubs (return 0)
- `internal/capture/screenshot.go` — screenshot — single file using `kbinani/screenshot` (cross-platform library that works on Windows/macOS/Linux but requires CGo on Linux and pulls in X11/Quartz deps)
- `cmd/watchdog/` — watchdog process — already split into `main_windows.go` and `main_other.go`

The Makefile already declares `build-darwin` and `build-linux` targets. The blockers preventing a clean cross-compile are:

1. `screenshot.go` is untagged and imports `kbinani/screenshot`, which has CGo requirements on Linux (X11) and macOS (CoreGraphics) that complicate pure cross-compilation; replacing with CLI-based approach on non-Windows platforms eliminates CGo for CI cross-compile checks.
2. `activity_darwin.go` and `activity_linux.go` are stubs — no real functionality.
3. `idle_darwin.go` and `idle_linux.go` always return 0 — no real idle detection.
4. `tools.go` has `golang.org/x/sys/windows` as a bare import with the `tools` build tag — fine because the tag excludes it from normal builds.

---

## Implementation Plan

### Step 1 — Split screenshot.go into platform-specific files

**Delete** `internal/capture/screenshot.go` (untagged, uses kbinani which needs CGo on non-Windows).

**Create** three replacements:

- `internal/capture/screenshot_windows.go` — keep kbinani approach (fastest, no tmp file I/O)
- `internal/capture/screenshot_darwin.go` — use `screencapture` CLI with tmp file
- `internal/capture/screenshot_linux.go` — use `scrot` CLI with `import` (ImageMagick) fallback

All three implement `CaptureScreenshot(dir string) (string, error)`.

### Step 2 — Implement macOS active window (activity_darwin.go)

Replace stub with real `osascript` implementation that returns app name and window title.

### Step 3 — Implement Linux active window (activity_linux.go)

Replace stub with real `xdotool` implementation that queries window ID, name, and PID.

### Step 4 — Implement macOS idle detection (idle_darwin.go)

Use `ioreg` (IOHIDSystem) to query idle time in nanoseconds, convert to seconds.

### Step 5 — Implement Linux idle detection (idle_linux.go)

Use `xprintidle` (milliseconds) with fallback to `xdotool` approach.

### Step 6 — Verify cross-platform compilation

Run `GOOS=darwin GOARCH=amd64 go build ./...` and `GOOS=linux GOARCH=amd64 go build ./...` from `apps/agent/`.

### Step 7 — Commit

Single commit: `feat(agent): add macOS and Linux cross-platform support`

---

## File Map

| File | Action |
|------|--------|
| `internal/capture/screenshot.go` | Delete (replace with platform files) |
| `internal/capture/screenshot_windows.go` | Create — kbinani library |
| `internal/capture/screenshot_darwin.go` | Create — screencapture CLI |
| `internal/capture/screenshot_linux.go` | Create — scrot/import CLI |
| `internal/capture/activity_darwin.go` | Update — osascript real impl |
| `internal/capture/activity_linux.go` | Update — xdotool real impl |
| `internal/capture/idle_darwin.go` | Update — ioreg real impl |
| `internal/capture/idle_linux.go` | Update — xprintidle/xdotool real impl |

The Makefile, `cmd/` packages, and `internal/platform/` require no changes.

---

## Notes

- The `kbinani/screenshot` library _does_ support macOS and Linux via CGo. We deliberately use CLI tools instead on those platforms to allow `GOOS=darwin/linux go build` cross-compilation from a Windows host without needing CGo cross-compilers.
- `screencapture`, `osascript`, and `ioreg` are built-in macOS tools — no extra packages needed.
- `scrot`, `xdotool`, and `xprintidle` must be installed on the Linux host at runtime; installer scripts should document this.
- All platform-specific files already carry the correct `//go:build <os>` tag.
