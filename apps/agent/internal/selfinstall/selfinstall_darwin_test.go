//go:build darwin

package selfinstall

import (
	"strings"
	"testing"
)

func TestRenderPlist_ContainsRequiredKeys(t *testing.T) {
	rendered, err := renderPlist(plistData{
		BinaryPath: "/Users/test/Library/Application Support/TimeChamp/timechamp-agent",
		LogDir:     "/Users/test/Library/Logs/TimeChamp",
		APIURL:     "https://api.timechamp.io/api/v1",
		Home:       "/Users/test",
	})
	if err != nil {
		t.Fatalf("renderPlist error: %v", err)
	}

	requiredStrings := []string{
		"com.timechamp.agent",
		"timechamp-agent",
		"RunAtLoad",
		"KeepAlive",
		"ProcessType",
		"Background",
		"ThrottleInterval",
		"AssociatedBundleIdentifiers",
		"com.timechamp.setup",
		"TC_API_URL",
		"https://api.timechamp.io/api/v1",
		"HOME",
		"/Users/test",
		"ExitTimeout",
		"agent.log",
		"agent_error.log",
	}
	for _, s := range requiredStrings {
		if !strings.Contains(rendered, s) {
			t.Errorf("plist missing %q\nGot:\n%s", s, rendered)
		}
	}
}

func TestIsMDMBlocked_DetectsError125(t *testing.T) {
	if !isMDMBlocked("125", "some launchctl output") {
		t.Error("expected MDM detection for exit code 125")
	}
}

func TestIsMDMBlocked_DetectsNotPermitted(t *testing.T) {
	if !isMDMBlocked("", "Operation not permitted by MDM policy") {
		t.Error("expected MDM detection for 'not permitted' message")
	}
}

func TestIsMDMBlocked_FalseForNormalError(t *testing.T) {
	if isMDMBlocked("1", "some other launchctl error") {
		t.Error("false positive MDM detection")
	}
}
