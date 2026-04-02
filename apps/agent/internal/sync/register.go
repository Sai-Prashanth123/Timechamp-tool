package sync

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// RegisterRequest is sent when an agent first activates.
type RegisterRequest struct {
	InviteToken string `json:"inviteToken"`
	Hostname    string `json:"hostname"`
	OS          string `json:"os"`
	OSVersion   string `json:"osVersion"`
}

// RegisterResponse is returned by the API on successful registration.
type RegisterResponse struct {
	Data struct {
		AgentToken string `json:"agentToken"`
		EmployeeID string `json:"employeeId"`
		OrgID      string `json:"orgId"`
	} `json:"data"`
}

// Register calls the API to register this agent installation.
// Returns the agent token, employeeID, and orgID on success.
func Register(apiURL, inviteToken, hostname, osName, osVersion string) (token, employeeID, orgID string, err error) {
	payload := RegisterRequest{
		InviteToken: inviteToken,
		Hostname:    hostname,
		OS:          osName,
		OSVersion:   osVersion,
	}

	data, _ := json.Marshal(payload)
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
