# Real-Time Streaming Design
**Date:** 2026-04-02  
**Status:** Approved  
**Scope:** Screen streaming, camera streaming, audio streaming for Time Champ workforce monitoring

---

## 1. Overview

Add real-time screen, camera, and audio streaming to Time Champ using a WebSocket-based MJPEG approach with selective local recording. Designed for 50–200 concurrent employee streams at minimal infrastructure cost (~$65/month for 200 employees at 8hr/day).

**Key decisions:**
- Transport: WebSocket binary frames (no base64 overhead, no media server)
- Format: JPEG frames for screen/camera, raw PCM for audio
- Scale: Socket.IO + Redis adapter (ElastiCache) for horizontal pod scaling
- Recording: on-demand only, triggered by manager, written locally by agent then uploaded

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Go Agent (employee PC)                │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Screen  │  │  Camera  │  │  Audio   │              │
│  │ Capture  │  │ Capture  │  │ Capture  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       └─────────────┴─────────────┘                     │
│                    StreamManager                         │
│              (FPS control, JPEG compress)                │
│                    WebSocket Client                      │
└──────────────────────┬──────────────────────────────────┘
                       │ Binary frames over WSS
                       ▼
┌─────────────────────────────────────────────────────────┐
│           NestJS Streaming Gateway (Socket.IO)           │
│                                                          │
│   Rooms per employee ──► Redis Pub/Sub ──► Scale out    │
│   JWT auth on connect      (ElastiCache)                 │
│   FPS command relay                                      │
└──────────────────────┬──────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
    Manager Grid View     Manager Full-Screen
    (1 FPS, all online)   (5 FPS + camera PiP
                           + audio waveform)
```

---

## 3. Binary Frame Protocol

All frames share a compact binary envelope multiplexed over one WebSocket connection per agent:

```
[1 byte type][4 bytes timestamp ms][2 bytes payload length][N bytes payload]
```

| Type byte | Stream |
|-----------|--------|
| `0x01` | Screen JPEG frame |
| `0x02` | Camera JPEG frame |
| `0x03` | Audio PCM chunk (16kHz mono, 160ms) |

---

## 4. Streaming Modes

| Mode | Screen FPS | Camera FPS | Audio | Trigger |
|------|-----------|-----------|-------|---------|
| `idle` | 0 | 0 | off | Default — no watchers |
| `grid` | 1 | 1 | on | At least one manager watching |
| `full` | 5 | 1 | on | Manager clicked employee tile |

Mode transitions are server-initiated via `stream:start` / `stream:upgrade` / `stream:stop` commands sent to the agent over WebSocket.

---

## 5. Go Agent Changes

### New files

```
apps/agent/internal/
├── capture/
│   ├── camera_windows.go      # DirectShow via ffmpeg CLI
│   ├── camera_darwin.go       # imagesnap CLI
│   ├── camera_linux.go        # v4l2-ctl + ffmpeg CLI
│   ├── audio_windows.go       # ffmpeg dshow audio
│   ├── audio_darwin.go        # ffmpeg avfoundation audio
│   ├── audio_linux.go         # ffmpeg alsa/pulse audio
│   └── stream_manager.go      # FPS control, JPEG encode, frame dispatch
├── stream/
│   ├── client.go              # gorilla/websocket persistent client
│   ├── protocol.go            # frame envelope encode/decode
│   └── recorder.go            # on-demand local MP4 recording via ffmpeg
```

### Camera capture strategy

Uses FFmpeg CLI (no CGo, no extra libraries). One-shot JPEG capture per cycle:

- **Windows:** `ffmpeg -f dshow -i video="<default>" -frames:v 1 -q:v 5 pipe:1`
- **macOS:** `imagesnap -` (outputs JPEG to stdout)
- **Linux:** `ffmpeg -f v4l2 -i /dev/video0 -frames:v 1 -q:v 5 pipe:1`

### Audio capture strategy

FFmpeg captures 160ms PCM chunks from default microphone continuously:

- **Windows:** `ffmpeg -f dshow -i audio="<default>" -ar 16000 -ac 1 -f s16le pipe:1`
- **macOS:** `ffmpeg -f avfoundation -i ":0" -ar 16000 -ac 1 -f s16le pipe:1`
- **Linux:** `ffmpeg -f alsa -i default -ar 16000 -ac 1 -f s16le pipe:1`

### StreamManager

- Manages goroutines for each capture type
- Starts/stops captures based on current mode
- JPEG encoding: screen at Q40 (grid) / Q60 (full), camera at Q50
- Dispatches frames to WebSocket client channel
- Exposes `SetMode(mode)` called by WebSocket client on server command

### WebSocket client

- Persistent connection to `wss://api/streaming` with JWT in handshake header
- Auto-reconnect with exponential backoff (1s, 2s, 4s… max 60s)
- Reads mode commands from server, calls `StreamManager.SetMode()`
- Writes binary frames from StreamManager to WebSocket

---

## 6. NestJS Streaming Gateway

### New module

```
apps/api/src/modules/streaming/
├── streaming.module.ts
├── streaming.gateway.ts       # @WebSocketGateway Socket.IO
├── streaming.service.ts       # room/session management
├── streaming.controller.ts    # REST endpoints
├── dto/
│   ├── frame.dto.ts
│   └── stream-command.dto.ts
└── guards/
    └── ws-jwt.guard.ts
```

### Socket.IO events

**Agent → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:register` | `{userId, orgId, token}` | Agent connects and identifies |
| `agent:frame` | binary buffer | Screen/camera/audio frame |
| `agent:disconnect` | — | Agent goes offline |

**Manager → Server:**

| Event | Payload | Description |
|-------|---------|-------------|
| `manager:watch` | `{userId}` | Join employee room, triggers grid mode |
| `manager:unwatch` | `{userId}` | Leave room, stops stream if no watchers |
| `manager:fullscreen` | `{userId}` | Upgrade employee to full mode |

**Server → Manager:**

| Event | Payload | Description |
|-------|---------|-------------|
| `stream:frame` | binary buffer | Relayed frame |
| `stream:online` | `{userId, name, avatar}` | Employee came online |
| `stream:offline` | `{userId}` | Employee went offline |

**Server → Agent:**

| Event | Payload | Description |
|-------|---------|-------------|
| `stream:start` | `{mode}` | Begin streaming at mode |
| `stream:upgrade` | `{mode}` | Change FPS mode |
| `stream:stop` | — | Stop all streams |

### Redis session registry

Hash key `streams:{orgId}`:
```json
{
  "userId": {
    "mode": "grid|full|idle",
    "startedAt": 1234567890,
    "watcherCount": 3,
    "socketId": "abc123"
  }
}
```

TTL: 24 hours. Updated on mode change. Deleted on agent disconnect.

### Bandwidth guard

If a single manager subscribes to more than 10 full-screen streams simultaneously, the server auto-downgrades streams beyond 10 to grid mode and notifies the manager.

### REST endpoints

```
GET  /streaming/active              # list active streams for org (managers only)
POST /streaming/record/:userId      # request on-demand recording
GET  /streaming/record/:recordingId # get recording download URL when ready
```

---

## 7. Web Dashboard Changes

### New files

```
apps/web/
├── components/streaming/
│   ├── stream-grid.tsx          # mosaic grid, virtual scroll
│   ├── stream-tile.tsx          # canvas tile + employee name + status dot
│   ├── stream-fullscreen.tsx    # modal: screen + camera PiP + audio waveform
│   ├── audio-waveform.tsx       # real-time PCM level bars
│   └── camera-pip.tsx           # picture-in-picture camera overlay
├── hooks/
│   └── use-streaming.ts         # Socket.IO client, binary frame decode, canvas render
└── app/(dashboard)/live/
    └── page.tsx                  # /live route, managers only
```

### Frame rendering

1. Binary frame arrives as `ArrayBuffer`
2. Parse envelope: read type byte, timestamp, payload
3. `Uint8Array` payload → `Blob` with `image/jpeg` MIME
4. `createObjectURL(blob)` → draw to `<canvas>` via `drawImage`
5. Revoke previous object URL immediately after draw (prevent memory leak)

### Audio playback

1. PCM chunk arrives as `ArrayBuffer`
2. `AudioContext.createBuffer(1, 2560, 16000)` — fill with Int16 samples normalized to Float32
3. `AudioContext.createBufferSource()` → connect to destination → start
4. Audio waveform: compute RMS of each chunk → animate bar heights

### Virtual scroll in grid

Off-screen tiles call `manager:unwatch` and stop receiving frames. On-screen tiles call `manager:watch`. Intersection Observer drives this automatically — managers only receive frames for visible tiles.

### Grid tile sizing

- Grid mode: 160×90px canvas, 1 FPS
- Full-screen modal: 1280×720px canvas, 5 FPS
- Camera PiP: 160×120px canvas, 1 FPS (top-right corner of modal)

---

## 8. Cost Analysis

**Per employee per hour (grid mode):**

| Stream | FPS | Avg frame size | MB/hr |
|--------|-----|---------------|-------|
| Screen | 1 | 12 KB | 43 MB |
| Camera | 1 | 8 KB | 29 MB |
| Audio | 6/sec | 5 KB | 108 MB |
| **Total** | | | **180 MB/hr** |

**At 200 employees, 8hr/day, 22 days/month:**
- Grid only: ~633 GB/month → **~$57/month** (AWS $0.09/GB)
- With 10 full-screen at any time (additional ~5 FPS screen): +~$8/month
- **Total estimated: ~$65/month for 200 employees**

> Note: Cost drops significantly if deployed behind CloudFront or if using internal VPC routing (no egress charges between ECS and ElastiCache).

---

## 9. Error Handling

| Scenario | Handling |
|----------|---------|
| Agent WebSocket drops | Auto-reconnect with backoff; server marks employee offline after 10s |
| Camera not available | Agent sends `camera:unavailable` event; tile shows placeholder |
| Audio permission denied | Agent skips audio frames; waveform shows flat line |
| Manager browser tab hidden | Page Visibility API pauses socket subscriptions |
| ECS pod restart | Redis session registry preserves state; new pod reconnects agent |
| Frame decode error | Canvas keeps previous frame; no crash |

---

## 10. Security

- WebSocket connections require valid JWT in handshake `Authorization` header
- Agents can only emit to their own `stream:{userId}` room
- Managers can only watch employees within their organization (enforced in `ws-jwt.guard.ts`)
- Employees can see in their agent tray icon when they are being watched (green dot)
- All WebSocket traffic over WSS (TLS)

---

## 11. Implementation Sub-tasks

1. **Agent — StreamManager + WebSocket client** (Go)
2. **Agent — Camera capture** (Windows/macOS/Linux)
3. **Agent — Audio capture** (Windows/macOS/Linux)
4. **Agent — On-demand recorder** (ffmpeg local MP4)
5. **API — Streaming module + Gateway** (NestJS)
6. **API — Redis session registry**
7. **API — REST recording endpoints**
8. **Web — Socket.IO hook + frame renderer**
9. **Web — Stream grid + virtual scroll**
10. **Web — Full-screen modal + camera PiP + audio waveform**
