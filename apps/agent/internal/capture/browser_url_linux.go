//go:build linux

package capture

// scrapeURLViaAccessibility on Linux would use AT-SPI (Assistive Technology Service Provider
// Interface) over D-Bus to read the browser address bar on GNOME/KDE desktops.
// For now returns "" — rely on Layer 1 (extension) and Layer 3 (title).
// TODO: implement via dbus AT-SPI
func scrapeURLViaAccessibility(_ ActiveWindow) string {
	return ""
}
