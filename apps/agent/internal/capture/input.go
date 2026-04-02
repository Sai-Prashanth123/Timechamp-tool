package capture

import "sync/atomic"

// InputCounter tracks keyboard and mouse activity atomically.
// Call IncrementKeys() and IncrementMouse() from OS hooks.
// Call Drain() to read and reset the counts each minute.
type InputCounter struct {
	keys  atomic.Int64
	mouse atomic.Int64
}

// IncrementKeys records one keystroke event.
func (c *InputCounter) IncrementKeys() {
	c.keys.Add(1)
}

// IncrementMouse records one mouse movement/click event.
func (c *InputCounter) IncrementMouse() {
	c.mouse.Add(1)
}

// Drain returns the current key and mouse counts, then resets both to zero.
func (c *InputCounter) Drain() (keys int, mouse int) {
	return int(c.keys.Swap(0)), int(c.mouse.Swap(0))
}
