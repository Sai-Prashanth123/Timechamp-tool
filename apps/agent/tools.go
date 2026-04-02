//go:build tools

package main

import (
	_ "github.com/kbinani/screenshot"
	_ "github.com/zalando/go-keyring"
	_ "golang.org/x/sys/windows"
	_ "modernc.org/sqlite"
)
