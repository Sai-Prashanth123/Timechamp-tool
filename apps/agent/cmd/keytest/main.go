package main

import (
	"fmt"
	"github.com/timechamp/agent/internal/keychain"
)

func main() {
	token, err := keychain.LoadToken()
	fmt.Printf("token=%q err=%v len=%d\n", token, err, len(token))
}
