package stream

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// StreamClient manages a persistent binary WebSocket connection to the streaming gateway.
type StreamClient struct {
	wsURL      string
	agentToken string
	conn       *websocket.Conn
	mu         sync.Mutex
	ctrlCh     chan []byte
	done       chan struct{}
}

// NewStreamClient creates a new StreamClient.
func NewStreamClient(wsURL, agentToken string) *StreamClient {
	return &StreamClient{
		wsURL:      wsURL,
		agentToken: agentToken,
		ctrlCh:     make(chan []byte, 16),
		done:       make(chan struct{}),
	}
}

// Connect establishes the WebSocket connection with retry.
func (c *StreamClient) Connect(ctx context.Context) error {
	opts := &websocket.DialOptions{
		HTTPHeader: map[string][]string{
			"Authorization": {"Bearer " + c.agentToken},
		},
	}
	conn, _, err := websocket.Dial(ctx, c.wsURL, opts)
	if err != nil {
		return fmt.Errorf("websocket dial: %w", err)
	}
	conn.SetReadLimit(4 * 1024 * 1024) // 4MB max frame
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// Start read loop for control frames
	go c.readLoop(ctx)
	return nil
}

// SendFrame sends a binary frame over the WebSocket connection.
func (c *StreamClient) SendFrame(ctx context.Context, frame []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}
	return conn.Write(ctx, websocket.MessageBinary, frame)
}

// ControlFrames returns a channel that receives CONTROL frame payloads.
func (c *StreamClient) ControlFrames() <-chan []byte {
	return c.ctrlCh
}

// Disconnect closes the connection.
func (c *StreamClient) Disconnect() {
	close(c.done)
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close(websocket.StatusNormalClosure, "agent disconnecting")
	}
	c.mu.Unlock()
}

func (c *StreamClient) readLoop(ctx context.Context) {
	for {
		select {
		case <-c.done:
			return
		default:
		}
		c.mu.Lock()
		conn := c.conn
		c.mu.Unlock()
		if conn == nil {
			return
		}
		_, msg, err := conn.Read(ctx)
		if err != nil {
			return
		}
		f, err := ParseFrame(msg)
		if err != nil {
			continue
		}
		if f.Type == FrameTypeControl {
			select {
			case c.ctrlCh <- f.Payload:
			default:
			}
		}
	}
}

// ConnectWithRetry connects with exponential backoff. Blocks until connected or ctx cancelled.
func (c *StreamClient) ConnectWithRetry(ctx context.Context) error {
	base := time.Second
	max := 60 * time.Second
	delay := base
	for {
		if err := c.Connect(ctx); err == nil {
			return nil
		}
		// Add jitter ±20%
		jitter := time.Duration(float64(delay) * (0.8 + rand.Float64()*0.4))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(jitter):
		}
		delay *= 2
		if delay > max {
			delay = max
		}
	}
}
