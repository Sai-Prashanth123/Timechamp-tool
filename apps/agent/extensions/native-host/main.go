// Command native-host is the Native Messaging host that bridges the Chrome
// extension and the main Time Champ agent process.
//
// Chrome communicates with native hosts via stdin/stdout using a 4-byte
// little-endian length prefix before each JSON message.
//
// The host forwards URL messages to the agent via a local TCP socket on
// 127.0.0.1:27182. The agent listens on that port and updates its
// "current browser URL" cache in real time.
package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"time"
)

// agentURLPort is the port the main agent listens on for URL messages.
const agentURLPort = "127.0.0.1:27182"

// message is the JSON structure exchanged with the extension.
type message struct {
	Type string `json:"type"`
	URL  string `json:"url,omitempty"`
}

func main() {
	// Read messages from Chrome (stdin) and forward to the agent.
	for {
		msg, err := readMessage(os.Stdin)
		if err != nil {
			if err == io.EOF {
				return // extension closed
			}
			writeMessage(os.Stdout, message{Type: "error"})
			os.Exit(1)
		}

		if msg.Type == "url" && msg.URL != "" {
			forwardURL(msg.URL)
		}

		// Ack back to the extension.
		writeMessage(os.Stdout, message{Type: "ack"})
	}
}

// readMessage reads a Chrome Native Messaging framed message from r.
func readMessage(r io.Reader) (message, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return message{}, err
	}
	if length > 1<<20 { // sanity check: 1 MiB max
		return message{}, fmt.Errorf("message too large: %d bytes", length)
	}

	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return message{}, err
	}

	var msg message
	if err := json.Unmarshal(buf, &msg); err != nil {
		return message{}, err
	}
	return msg, nil
}

// writeMessage writes a Chrome Native Messaging framed message to w.
func writeMessage(w io.Writer, msg message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	length := uint32(len(data))
	binary.Write(w, binary.LittleEndian, length)
	w.Write(data)
}

// forwardURL sends the URL to the agent's URL listener socket.
func forwardURL(url string) {
	conn, err := net.DialTimeout("tcp", agentURLPort, 2*time.Second)
	if err != nil {
		return // agent not running; silently drop
	}
	defer conn.Close()
	conn.SetWriteDeadline(time.Now().Add(1 * time.Second))

	data, _ := json.Marshal(message{Type: "url", URL: url})
	length := uint32(len(data))
	binary.Write(conn, binary.LittleEndian, length)
	conn.Write(data)
}
