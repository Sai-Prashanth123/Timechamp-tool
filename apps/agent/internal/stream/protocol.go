package stream

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
)

const (
	FrameVersion         = byte(0x01)
	FrameTypeScreenDelta = byte(0x01)
	FrameTypeScreenFull  = byte(0x02)
	FrameTypeCamera      = byte(0x03)
	FrameTypeAudio       = byte(0x04)
	FrameTypeHeartbeat   = byte(0x05)
	FrameTypeACK         = byte(0x06)
	FrameTypeControl     = byte(0x07)
	headerSize           = 8
)

// Frame represents a parsed binary frame.
type Frame struct {
	Type    byte
	Payload []byte
}

// BuildFrame creates an 8-byte header + payload binary frame.
// Header layout: [version(1)][type(1)][reserved(2)][payloadLen uint32 BE(4)]
func BuildFrame(frameType byte, payload []byte) []byte {
	header := make([]byte, headerSize)
	header[0] = FrameVersion
	header[1] = frameType
	binary.BigEndian.PutUint32(header[4:], uint32(len(payload)))
	result := make([]byte, headerSize+len(payload))
	copy(result, header)
	copy(result[headerSize:], payload)
	return result
}

// ParseFrame parses a binary frame from raw bytes.
func ParseFrame(data []byte) (*Frame, error) {
	if len(data) < headerSize {
		return nil, fmt.Errorf("frame too short: %d bytes", len(data))
	}
	payloadLen := binary.BigEndian.Uint32(data[4:8])
	if uint32(len(data)) < uint32(headerSize)+payloadLen {
		return nil, fmt.Errorf("incomplete frame: expected %d bytes, got %d", headerSize+payloadLen, len(data))
	}
	return &Frame{
		Type:    data[1],
		Payload: data[headerSize : headerSize+payloadLen],
	}, nil
}

// BuildControlFrame creates a CONTROL frame with JSON payload.
func BuildControlFrame(payload map[string]interface{}) []byte {
	b, _ := json.Marshal(payload)
	return BuildFrame(FrameTypeControl, b)
}

// BuildHeartbeatFrame creates a HEARTBEAT frame with empty payload.
func BuildHeartbeatFrame() []byte {
	return BuildFrame(FrameTypeHeartbeat, []byte{})
}
