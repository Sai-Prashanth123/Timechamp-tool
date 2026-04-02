.PHONY: build build-windows build-darwin build-linux test clean

AGENT_BIN   := timechamp-agent
WATCHDOG_BIN := timechamp-watchdog

build: build-windows

build-windows:
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/windows/$(AGENT_BIN).exe ./cmd/agent
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o dist/windows/$(WATCHDOG_BIN).exe ./cmd/watchdog

build-darwin:
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/darwin/$(AGENT_BIN) ./cmd/agent
	GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o dist/darwin/$(WATCHDOG_BIN) ./cmd/watchdog

build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/linux/$(AGENT_BIN) ./cmd/agent
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o dist/linux/$(WATCHDOG_BIN) ./cmd/watchdog

test:
	go test ./... -v -timeout 30s

clean:
	rm -rf dist/
