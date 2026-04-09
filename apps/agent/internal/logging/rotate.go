// Package logging provides a size-capped rotating log writer.
package logging

import (
	"fmt"
	"os"
	"sync"
)

// RotatingWriter writes to a file and rotates it when it reaches maxSize bytes.
// Keeps up to 3 backup files (path.1, path.2, path.3); oldest is removed.
// Thread-safe — safe to use as log.SetOutput target.
type RotatingWriter struct {
	mu      sync.Mutex
	path    string
	maxSize int64
	file    *os.File
	size    int64
}

// NewRotatingWriter opens (or creates) the log file at path and returns a writer
// that rotates when the file reaches maxBytes.
func NewRotatingWriter(path string, maxBytes int64) (*RotatingWriter, error) {
	w := &RotatingWriter{path: path, maxSize: maxBytes}
	if err := w.open(); err != nil {
		return nil, err
	}
	return w, nil
}

// Write implements io.Writer. Rotates the file if the size limit is reached.
func (w *RotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n, err := w.file.Write(p)
	w.size += int64(n)
	if w.size >= w.maxSize {
		_ = w.rotate()
	}
	return n, err
}

// Close closes the underlying log file.
func (w *RotatingWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file != nil {
		return w.file.Close()
	}
	return nil
}

func (w *RotatingWriter) rotate() error {
	w.file.Close()
	// Shift backups: .2→.3, .1→.2, current→.1 (remove .3 first).
	// Renames are best-effort — a partial failure (e.g. cross-device rename,
	// read-only filesystem) must not leave the writer permanently broken.
	// We always try to open a fresh log file regardless of rename outcomes.
	_ = os.Remove(w.path + ".3")
	_ = os.Rename(w.path+".2", w.path+".3")
	_ = os.Rename(w.path+".1", w.path+".2")
	_ = os.Rename(w.path, w.path+".1")
	return w.open()
}

func (w *RotatingWriter) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return fmt.Errorf("open log file %s: %w", w.path, err)
	}
	fi, err := f.Stat()
	if err != nil {
		f.Close()
		return fmt.Errorf("stat log file: %w", err)
	}
	w.file = f
	w.size = fi.Size()
	return nil
}
