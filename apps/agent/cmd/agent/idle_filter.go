package main

// medianUint32 returns the median of a [3]uint32 array without allocation.
// Used to smooth the 1-second idle samples so that momentary spikes (e.g. a
// single GetLastInputInfo glitch) do not flip the AFK state.
func medianUint32(a [3]uint32) uint32 {
	x, y, z := a[0], a[1], a[2]
	if x > y {
		x, y = y, x
	}
	if y > z {
		y, z = z, y
	}
	if x > y {
		x, y = y, x
	}
	_ = x
	_ = z
	return y // middle value
}
