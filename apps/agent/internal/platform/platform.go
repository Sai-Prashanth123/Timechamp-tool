package platform

// DataDir returns the OS-appropriate directory for agent data storage.
func DataDir() string {
	return dataDir()
}
