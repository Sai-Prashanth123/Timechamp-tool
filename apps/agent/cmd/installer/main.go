// Command installer installs, uninstalls, starts, and stops the TimeChamp agent
// as an OS service. Must be run with administrator/root privileges.
//
// Usage:
//
//	installer install   [--binary <path>]
//	installer uninstall
//	installer start
//	installer stop
//	installer status
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/timechamp/agent/internal/service"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(1)
	}

	cmd := os.Args[1]
	flags := flag.NewFlagSet(cmd, flag.ExitOnError)
	binaryPath := flags.String("binary", "", "path to agent binary (default: this executable's directory)")
	flags.Parse(os.Args[2:])

	mgr := service.New()

	switch cmd {
	case "install":
		bin := *binaryPath
		if bin == "" {
			// Default: look for timechamp-agent[.exe] next to the installer.
			exe, err := os.Executable()
			if err != nil {
				fatalf("could not determine executable path: %v", err)
			}
			dir := dirOf(exe)
			bin = findAgent(dir)
			if bin == "" {
				fatalf("agent binary not found in %s; use --binary <path>", dir)
			}
		}
		if err := mgr.Install(bin); err != nil {
			fatalf("install failed: %v", err)
		}

	case "uninstall":
		if err := mgr.Uninstall(); err != nil {
			fatalf("uninstall failed: %v", err)
		}
		fmt.Println("Service uninstalled.")

	case "start":
		if err := mgr.Start(); err != nil {
			fatalf("start failed: %v", err)
		}
		fmt.Println("Service started.")

	case "stop":
		if err := mgr.Stop(); err != nil {
			fatalf("stop failed: %v", err)
		}
		fmt.Println("Service stopped.")

	case "status":
		state, err := mgr.Status()
		if err != nil {
			fatalf("status check failed: %v", err)
		}
		fmt.Printf("Service status: %s\n", state)

	default:
		fmt.Fprintf(os.Stderr, "unknown command: %q\n\n", cmd)
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `TimeChamp Agent Installer

Usage:
  installer install   [--binary <path>]
  installer uninstall
  installer start
  installer stop
  installer status

Must be run as Administrator (Windows) or with sudo (macOS).`)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}

func dirOf(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[:i]
		}
	}
	return "."
}

func findAgent(dir string) string {
	candidates := []string{"timechamp-agent.exe", "timechamp-agent"}
	for _, name := range candidates {
		p := dir + "/" + name
		if _, err := os.Stat(p); err == nil {
			return p
		}
		p = dir + "\\" + name
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}
