package main

import (
    "fmt"
    "os"
    keyring "github.com/zalando/go-keyring"
)

func main() {
    token, err := keyring.Get("TimeChamp", "agent-token")
    if err != nil {
        fmt.Fprintf(os.Stderr, "keychain error: %v\n", err)
        os.Exit(1)
    }
    if token == "" {
        fmt.Fprintln(os.Stderr, "token empty")
        os.Exit(1)
    }
    fmt.Printf("token found: %s...\n", token[:8])
}
