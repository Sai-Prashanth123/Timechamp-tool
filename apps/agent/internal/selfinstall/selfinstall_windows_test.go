//go:build windows

package selfinstall

import (
	"encoding/json"
	"os"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestHandoffRoundTrip(t *testing.T) {
	binaryPath := `C:\Users\test\AppData\Local\TimeChamp\timechamp-agent.exe`

	path, err := writeHandoff(binaryPath)
	if err != nil {
		t.Fatalf("writeHandoff: %v", err)
	}
	// readHandoff deletes the file — don't defer Remove.

	got, err := readHandoff(path)
	if err != nil {
		t.Fatalf("readHandoff: %v", err)
	}
	if got != binaryPath {
		t.Errorf("got %q, want %q", got, binaryPath)
	}

	// Confirm file was deleted.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("handoff file was not deleted after readHandoff")
	}
}

func TestHandoffJSON_IsValidJSON(t *testing.T) {
	f, err := os.CreateTemp("", "handoff-*.json")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())

	binaryPath := `C:\foo\bar.exe`
	data, _ := json.Marshal(map[string]string{"binaryPath": binaryPath})
	f.Write(data)
	f.Close()

	got, err := readHandoff(f.Name())
	if err != nil {
		t.Fatalf("readHandoff: %v", err)
	}
	if got != binaryPath {
		t.Errorf("got %q, want %q", got, binaryPath)
	}
}

func TestInstallRegistryRunKey(t *testing.T) {
	binaryPath := `C:\test\timechamp-agent.exe`
	if err := installRegistryRunKey(binaryPath); err != nil {
		t.Fatalf("installRegistryRunKey: %v", err)
	}
	defer func() {
		k, _ := registry.OpenKey(registry.CURRENT_USER,
			windowsRegRunPath, registry.SET_VALUE)
		k.DeleteValue(windowsRegValueKey)
		k.Close()
	}()

	k, err := registry.OpenKey(registry.CURRENT_USER,
		windowsRegRunPath, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("OpenKey: %v", err)
	}
	defer k.Close()

	val, _, err := k.GetStringValue(windowsRegValueKey)
	if err != nil {
		t.Fatalf("GetStringValue: %v", err)
	}
	want := `"` + binaryPath + `"`
	if val != want {
		t.Errorf("got %q, want %q", val, want)
	}
}
