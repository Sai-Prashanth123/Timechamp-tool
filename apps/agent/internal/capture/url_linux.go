//go:build linux

package capture

// getBrowserURL returns an empty string on Linux (not yet implemented).
// A future version may use AT-SPI accessibility API via dbus.
func getBrowserURL(_ string) string {
	return ""
}

