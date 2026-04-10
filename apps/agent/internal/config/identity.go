package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Identity holds the persisted agent registration data.
type Identity struct {
	OrgID      string `json:"orgId"`
	EmployeeID string `json:"employeeId"`
	APIURL     string `json:"apiUrl,omitempty"`
}

// SaveIdentity writes orgID, employeeID, and apiURL to a JSON file in dataDir.
func SaveIdentity(dataDir, orgID, employeeID string, apiURL ...string) error {
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return err
	}
	id := Identity{OrgID: orgID, EmployeeID: employeeID}
	if len(apiURL) > 0 {
		id.APIURL = apiURL[0]
	}
	data, err := json.Marshal(id)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dataDir, "identity.json"), data, 0600)
}

// LoadIdentity reads the saved identity from dataDir.
// Returns zero-value Identity if the file does not exist.
func LoadIdentity(dataDir string) (Identity, error) {
	path := filepath.Join(dataDir, "identity.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Identity{}, nil
	}
	if err != nil {
		return Identity{}, err
	}
	var id Identity
	return id, json.Unmarshal(data, &id)
}
