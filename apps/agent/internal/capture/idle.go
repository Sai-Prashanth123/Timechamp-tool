package capture

// IdleSeconds returns the number of seconds since the user last had input.
// The implementation is OS-specific.
func IdleSeconds() (int, error) {
	return idleSeconds()
}
