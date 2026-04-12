//go:build !darwin && !windows

package main

// ensureAutoStart is a no-op on platforms without a built-in per-user
// auto-start mechanism we want to use.
//
// Linux distributions vary too much in their init systems (systemd-user vs
// sysvinit vs upstart vs runit vs openrc) for a one-size-fits-all approach.
// Users who want auto-start on Linux should add a systemd user unit at
// ~/.config/systemd/user/timechamp-agent.service pointing at the agent
// binary, then run `systemctl --user enable --now timechamp-agent`. We
// don't write that file automatically because (a) the path varies by distro
// and (b) systemctl --user is not available on every install.
//
// FreeBSD, OpenBSD, etc. — same story. Out of scope.
func ensureAutoStart() {}
