package sync

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// RegisterRequest is sent when an agent first activates.
//
// The API accepts either `InviteToken` (legacy one-time email invites) or
// `PersonalToken` (new reusable per-user token from /settings/agent), but
// not both. Exactly one must be populated. `DisplayName` is an optional
// human label shown on the admin dashboard — if empty, the server falls
// back to `Hostname`.
type RegisterRequest struct {
	InviteToken   string `json:"inviteToken,omitempty"`
	PersonalToken string `json:"personalToken,omitempty"`
	DisplayName   string `json:"displayName,omitempty"`
	Hostname      string `json:"hostname"`
	OS            string `json:"os"`
	OSVersion     string `json:"osVersion"`
}

// RegisterResponse is returned by the API on successful registration.
type RegisterResponse struct {
	Data struct {
		AgentToken string `json:"agentToken"`
		EmployeeID string `json:"employeeId"`
		OrgID      string `json:"orgId"`
	} `json:"data"`
}

// Register calls the API to register this agent installation using the
// legacy one-time invite token flow. Kept for backwards compatibility;
// new callers should prefer RegisterWithPersonalToken.
func Register(apiURL, inviteToken, hostname, osName, osVersion string) (token, employeeID, orgID string, err error) {
	return doRegister(apiURL, RegisterRequest{
		InviteToken: inviteToken,
		Hostname:    hostname,
		OS:          osName,
		OSVersion:   osVersion,
	})
}

// RegisterWithPersonalToken is the new primary registration path. The user
// generates a reusable token from /settings/agent, pastes it into the
// agent's setup form along with a display name for the machine, and this
// function submits both to the API. Returns the per-device token the
// agent must use for all subsequent API calls.
func RegisterWithPersonalToken(
	apiURL, personalToken, displayName, hostname, osName, osVersion string,
) (token, employeeID, orgID string, err error) {
	return doRegister(apiURL, RegisterRequest{
		PersonalToken: personalToken,
		DisplayName:   displayName,
		Hostname:      hostname,
		OS:            osName,
		OSVersion:     osVersion,
	})
}

func doRegister(apiURL string, payload RegisterRequest) (token, employeeID, orgID string, err error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", "", "", fmt.Errorf("marshal register payload: %w", err)
	}
	httpClient := &http.Client{Timeout: 15 * time.Second}

	resp, err := httpClient.Post(
		apiURL+"/agent/register",
		"application/json",
		strings.NewReader(string(data)),
	)
	if err != nil {
		return "", "", "", fmt.Errorf("register request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", "", "", fmt.Errorf("register failed with status %d", resp.StatusCode)
	}

	var result RegisterResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", "", fmt.Errorf("decode response: %w", err)
	}

	return result.Data.AgentToken, result.Data.EmployeeID, result.Data.OrgID, nil
}
