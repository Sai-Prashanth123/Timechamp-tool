# Time Champ Clone — Deep Technical Architecture
**Date:** 2026-04-05  
**Status:** Approved  
**Based on:** Actual codebase (44 Go files, 100+ TypeScript files, verified 2026-04-05)

---

## Table of Contents

1. [What We Are Building](#1-what-we-are-building)
2. [Full Feature List](#2-full-feature-list)
3. [Complete Tech Stack](#3-complete-tech-stack)
4. [Full System Architecture Diagram](#4-full-system-architecture-diagram)
5. [Feature-by-Feature Technical Flow](#5-feature-by-feature-technical-flow)
6. [Desktop Agent — Deep Dive](#6-desktop-agent--deep-dive)
7. [Streaming Architecture — Deep Dive](#7-streaming-architecture--deep-dive)
8. [Backend API — Deep Dive](#8-backend-api--deep-dive)
9. [Web Dashboard — Deep Dive](#9-web-dashboard--deep-dive)
10. [All Databases — Types, Roles, Why](#10-all-databases--types-roles-why)
11. [All Cloud Services — What, Why, How](#11-all-cloud-services--what-why-how)
12. [Technology Tradeoffs — Why Each Choice](#12-technology-tradeoffs--why-each-choice)

---

## 1. What We Are Building

A **B2B SaaS workforce intelligence and monitoring platform**. Companies subscribe, install our agent on employee PCs, and get:

- Automatic screenshot capture every 5 minutes
- App, website, keystroke activity tracking
- **On-demand live screen streaming** — manager watches any employee's screen live
- **On-demand live camera streaming** — manager sees employee's webcam
- **On-demand live audio streaming** — manager hears employee's microphone
- Automatic timesheets and attendance
- GPS tracking and geo-fenced field staff management
- Productivity analytics and reports
- Project management (Kanban, tasks, milestones)
- Integrations (Slack, Jira, webhooks)

**Revenue model:** ₹499/user/month (~$6 USD). Multi-tenant — each company is completely isolated.

---

## 2. Full Feature List

| # | Feature | How Triggered | Technology |
|---|---|---|---|
| 1 | Screenshot capture (every 5 min) | Automatic | Go agent, OS screenshot API, Backblaze B2 |
| 2 | App + website tracking | Automatic | Go agent, OS process API, browser extension |
| 3 | Keystroke count (not content) | Automatic | Go agent, OS input hook |
| 4 | Mouse activity | Automatic | Go agent, OS input hook |
| 5 | Idle detection | Automatic | Go agent, input inactivity threshold |
| 6 | **Live screen streaming** | Manager on-demand | Go agent delta encoder, WebSocket, Socket.io |
| 7 | **Live camera streaming** | Manager on-demand | Go agent ffmpeg webcam capture, WebSocket |
| 8 | **Live audio streaming** | Manager on-demand | Go agent ffmpeg mic capture, WebSocket |
| 9 | Automatic time tracking + timesheets | Automatic | NestJS, PostgreSQL, queue workers |
| 10 | Clock in / clock out | User action / geo-fence | Mobile app, NestJS, GPS geofence check |
| 11 | Real-time dashboard | Always-on | Next.js, Socket.io, Valkey pub/sub |
| 12 | Productivity analytics | Pre-aggregated | NestJS queue workers, PostgreSQL |
| 13 | Project management (Kanban) | Manager | Next.js dnd-kit, NestJS, PostgreSQL |
| 14 | GPS tracking + geo-fencing | Mobile background | React Native expo-location, NestJS |
| 15 | Mobile app (iOS + Android) | Employee/manager | React Native + Expo |
| 16 | Alerts + notifications | Rule-based | NestJS, Brevo email, FCM/APNs push |
| 17 | Billing + subscriptions | Admin | Stripe, NestJS billing module |
| 18 | Integrations (Slack, Jira) | Admin configure | NestJS integrations module, webhooks |

---

## 3. Complete Tech Stack

### Overview Table

| Layer | Technology | Version | Why |
|---|---|---|---|
| **Desktop Agent** | Go | 1.22 | Single binary, < 1% CPU, < 50 MB RAM, native OS APIs |
| **Screen Capture** | kbinani/screenshot (Go lib) | latest | Cross-platform, no ffmpeg dependency for screenshots |
| **Camera + Audio Capture** | ffmpeg CLI | latest | Best cross-platform AV capture, no native SDK needed |
| **Agent WebSocket** | nhooyr.io/websocket | v1.8.11 | Binary frame support, low latency, pure Go |
| **Agent Offline Buffer** | modernc.org/sqlite (SQLite) | latest | Embedded, ACID, zero dependency, pure Go |
| **Agent Credential Store** | go-keyring | latest | OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service) |
| **Backend API** | NestJS (Node.js + TypeScript) | latest | Structured modules, DI, built-in WebSocket, Swagger |
| **API WebSocket** | Socket.io | v4 | Room-based pub/sub, reconnection, binary support |
| **API Redis Adapter** | @socket.io/redis-adapter | latest | Scales Socket.io across multiple API processes |
| **ORM** | TypeORM | latest | PostgreSQL support, migrations, RLS-compatible |
| **Validation** | class-validator + Zod | latest | DTO validation in NestJS + schema validation |
| **Web Dashboard** | Next.js 14 (App Router) | 14.2.0 | SSR, RSC, performance, file-based routing |
| **UI Components** | shadcn/ui + Radix UI + Tailwind | latest | Accessible, unstyled primitives + Tailwind |
| **Server State** | TanStack Query | latest | Cache, background refetch, optimistic updates |
| **Client State** | Zustand | latest | Minimal, fast, no boilerplate |
| **Forms** | React Hook Form + Zod | latest | Performant forms, schema validation |
| **Real-time (browser)** | socket.io-client | v4.8.3 | Matches server Socket.io |
| **Mobile App** | React Native + Expo (bare workflow) | latest | iOS + Android from one codebase |
| **Mobile GPS** | expo-location | latest | Background GPS, battery-optimized |
| **Mobile Offline** | WatermelonDB | latest | Offline-first, built-in sync protocol |
| **Mobile Push** | Expo Notifications + FCM/APNs | latest | Cross-platform push notifications |
| **Primary Database** | PostgreSQL 16 | 16 | RLS for multi-tenancy, ACID, TypeORM |
| **Connection Pooler** | PgBouncer | latest | Multiplexes connections, saves RAM |
| **Cache + Pub/Sub** | Valkey (Redis fork) | latest | In-memory, pub/sub for WebSocket fan-out, $0 self-hosted |
| **File Storage** | Backblaze B2 | API | $0.006/GB, S3-compatible, zero egress via Cloudflare |
| **File CDN** | Cloudflare CDN | Free plan | Zero egress via Bandwidth Alliance with B2 |
| **Email** | Brevo | Free plan | 9,000 emails/month free |
| **Payments** | Stripe | latest | Subscription billing, seat management |
| **Compute** | Oracle Cloud A1 ARM | Always Free | 4 OCPU / 24 GB RAM — free forever |
| **Process Manager** | PM2 | latest | NestJS + Next.js process management on Oracle VMs |
| **Reverse Proxy** | NGINX | latest | SSL termination, static serving, load balancing |
| **CI/CD** | GitHub Actions | latest | Build, test, deploy on push |
| **Monorepo** | pnpm workspaces | latest | Single repo: agent + api + web + packages |

---

## 4. Full System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════════╗
║                           CLIENT LAYER                                    ║
║                                                                            ║
║  ┌─────────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  ║
║  │   Go Desktop Agent  │  │  Next.js Web App │  │ React Native Mobile │  ║
║  │   Windows/Mac/Linux │  │  Manager/Admin   │  │ Employee/Manager    │  ║
║  │                     │  │                  │  │                     │  ║
║  │ • Screenshot capture│  │ • Dashboard      │  │ • Clock in/out      │  ║
║  │ • App/URL tracking  │  │ • Live streams   │  │ • GPS tracking      │  ║
║  │ • Keystrokes/mouse  │  │ • Analytics      │  │ • Task updates      │  ║
║  │ • Screen streaming  │  │ • Reports        │  │ • Offline support   │  ║
║  │ • Camera streaming  │  │ • Projects       │  │                     │  ║
║  │ • Audio streaming   │  │ • GPS map        │  │ WatermelonDB        │  ║
║  │                     │  │                  │  │ (offline buffer)    │  ║
║  │ SQLite buffer        │  │ socket.io-client │  │                     │  ║
║  │ (offline, ACID)     │  │ TanStack Query   │  │ expo-location       │  ║
║  │ nhooyr.io/websocket │  │ Zustand          │  │ (background GPS)    │  ║
║  └──────────┬──────────┘  └────────┬─────────┘  └──────────┬──────────┘  ║
╚═════════════╪════════════════════════╪════════════════════════╪═══════════╝
              │                       │                        │
      HTTPS REST              HTTPS + WSS               HTTPS REST
      (batch sync)            (dashboard +               (GPS batches)
      WSS Binary              live streams)
      (streaming)
              │                       │                        │
╔═════════════╪═══════════════════════╪════════════════════════╪═══════════╗
║             ▼                       ▼                        ▼            ║
║         CLOUDFLARE (Always Free — DNS, DDoS, SSL, CDN)                   ║
║                                                                            ║
║   • Routes HTTPS/WSS to Oracle NLB                                        ║
║   • Serves screenshots/files from B2 — zero egress                        ║
║   • DDoS protection, SSL termination                                       ║
║   • NOTE: WebSocket streams bypass Cloudflare (go direct to Oracle NLB)  ║
╚═══════════════════════════════╪══════════════════════════════════════════╝
                                │
                        Oracle NLB (free)
                                │
╔═══════════════════════════════╪══════════════════════════════════════════╗
║           ORACLE VM1 — 2 OCPU / 12 GB ARM (NestJS Server)                ║
║                                                                            ║
║   NGINX (port 80/443)                                                      ║
║     └─→ NestJS API (cluster: 2 workers via PM2)                           ║
║           │                                                                ║
║           ├── REST /api/v1/...                                             ║
║           │     ├── auth/              JWT, OAuth, MFA                     ║
║           │     ├── organizations/     Multi-tenancy                       ║
║           │     ├── users/             Roles, invites                      ║
║           │     ├── monitoring/        Screenshot metadata, activity       ║
║           │     ├── streaming/         Session management, bandwidth       ║
║           │     ├── time-tracking/     Timesheets, clock in/out            ║
║           │     ├── projects/          Kanban, tasks, milestones           ║
║           │     ├── gps/               Locations, geofences, routes        ║
║           │     ├── analytics/         Scores, reports                     ║
║           │     ├── integrations/      Slack, Jira, webhooks               ║
║           │     ├── notifications/     Email, push                         ║
║           │     └── billing/           Stripe                              ║
║           │                                                                ║
║           └── WebSocket /ws (Socket.io)                                    ║
║                 ├── streaming.gateway.ts                                   ║
║                 │     ├── Agent connections (binary frames IN)             ║
║                 │     ├── Manager connections (binary frames OUT)          ║
║                 │     ├── Control frames (start/stop stream)               ║
║                 │     └── Room: org_{id} — isolates per tenant             ║
║                 └── @socket.io/redis-adapter → Valkey pub/sub             ║
║                       (all workers share same WebSocket state)             ║
║                                                                            ║
║   PgBouncer (connection pool)                                              ║
║     └─→ PostgreSQL on VM2 (private VCN only)                              ║
╚═════════════════════════════════════════╪════════════════════════════════╝
                                          │ Private Oracle VCN
╔═════════════════════════════════════════╪════════════════════════════════╗
║           ORACLE VM2 — 2 OCPU / 12 GB ARM (Data Layer)                   ║
║                                                                            ║
║   PostgreSQL 16                                                            ║
║     • All business data (users, orgs, activity, screenshots metadata,     ║
║       time entries, GPS, projects, analytics, streaming sessions)          ║
║     • Row Level Security on org_id — kernel-level tenant isolation         ║
║     • Partitioned tables: activity_events, gps_locations (by month)        ║
║     • 200 GB Oracle block storage (boot vols + DB data)                   ║
║                                                                            ║
║   Valkey (Redis-compatible, MIT license)                                   ║
║     • Cache-aside: hot analytics, employee lists (5 min TTL)               ║
║     • Pub/sub: bridges Socket.io workers for live updates + streams        ║
║     • Rate limiting: INCR per tenant per minute                            ║
║     • Job queue: screenshot compress, report generate, email send          ║
║     • JWT blacklist                                                         ║
║                                                                            ║
║   Next.js SSR + NGINX                                                      ║
║     • Serves web dashboard (server-side rendered)                          ║
║     • Static assets served by NGINX                                        ║
╚════════════════════════════════════════════════════════════════════════════╝

External Services (all API calls from VM1):

  Backblaze B2 ←── presigned PUT from agent/browser (screenshots, reports)
       ↕ free via Bandwidth Alliance
  Cloudflare CDN ──→ browser (serves B2 files, zero egress cost)

  Brevo ←── NestJS mailer (transactional email: alerts, reports, welcome)
  Stripe ←── NestJS billing (subscriptions, seat management, webhooks)
  FCM / APNs ←── NestJS notifications (push to mobile app)
```

---

## 5. Feature-by-Feature Technical Flow

### Flow A: Agent Captures Screenshot → Manager Sees It Live

```
1. Go agent (every 5 min):
   kbinani/screenshot.CaptureDisplay()
   → compress JPEG via resize.go
   → write to SQLite buffer: INSERT INTO screenshots_buffer

2. Background goroutine (every 30s):
   SELECT unsynced screenshots FROM SQLite
   → POST /api/v1/monitoring/screenshot-url
   → NestJS returns presigned B2 upload URL (15 min expiry)
   → Agent: PUT {file} to B2 via presigned URL  ← DIRECT, bypasses API
   → POST /api/v1/monitoring/screenshot-confirm { b2_key, captured_at }

3. NestJS monitoring module:
   → validates JWT + tenant guard
   → TypeORM: INSERT into screenshots table (metadata only)
   → Valkey PUBLISH org_{id} { type: "screenshot", employee_id, b2_key }

4. Socket.io gateway (streaming.gateway.ts):
   → all workers subscribed via redis-adapter
   → emits "screenshot" event to room org_{id}
   → manager's browser receives event via socket.io-client

5. Manager's browser (live-page-client.tsx):
   → receives screenshot event
   → requests: GET cdn.domain.com/screenshots/{key}.jpg
   → Cloudflare CDN serves from edge cache (> 95% hit rate)
   → if cache miss: Cloudflare pulls from B2 (free via Bandwidth Alliance)
   → screenshot appears in grid
```

---

### Flow B: Manager Starts Live Screen Stream → Sees Employee Screen

```
1. Manager clicks "Live View" on employee card (browser):
   socket.emit("start_stream", { employee_id, mode: "full" })

2. NestJS streaming.gateway.ts:
   → validates manager JWT, checks org ownership of employee
   → checks org streaming config (enabled? bandwidth cap reached?)
   → generates session_id
   → Valkey PUBLISH agent_{employee_id} {
       action: "start_full",
       session_id,
       fps: 5
     }

3. Go agent receives control frame (stream/client.go):
   → ParseControlFrame() → action = "start_full"
   → StreamManager.SetMode("full")

4. stream/manager.go starts screen capture loop:
   → capture/screen_image_{platform}.go captures frame
   → stream/delta.go processes frame:
       a. Divide screen into 16×16 blocks
       b. Compute hash of each block
       c. Compare with previous frame hashes
       d. If > 60% blocks changed → send ScreenFull JPEG
       e. If < 60% changed → send ScreenDelta:
            bitfield (which blocks changed) + only changed block data
       f. JPEG quality: 60 for full mode, 40 for grid mode
   → stream/protocol.go BuildFrame(ScreenDelta, payload)
       Header: version(1) + type(0x01) + reserved(2) + len(4) = 8 bytes
   → nhooyr.io/websocket.Write(binary frame)

5. NestJS streaming.gateway.ts receives binary frame:
   → route by frame type
   → if ScreenDelta/ScreenFull: relay to manager socket room
   → track bandwidth: session bytes += frame size
   → if daily bandwidth cap exceeded: send BandwidthCapExceeded control frame

6. Manager's browser (live-page-client.tsx):
   → receives binary frame via socket.io
   → decode: if ScreenFull → replace canvas
   → decode: if ScreenDelta → read bitfield, apply only changed 16×16 blocks
   → requestAnimationFrame for smooth rendering
```

---

### Flow C: Manager Starts Camera + Audio Stream

```
CAMERA:
1. Manager triggers camera stream
2. Control frame → agent → capture/camera_{platform}.go:
   ffmpeg -f dshow -i video="{webcam}" -vf scale=320:240
          -f mjpeg -q:v 5 -r 10 pipe:1
   → reads MJPEG frames from stdout
   → wraps each frame in protocol.BuildFrame(Camera, jpeg_bytes)
   → sends via WebSocket

3. NestJS relays Camera frames to manager's socket
4. Browser renders MJPEG stream in <canvas> or <img> tag

AUDIO:
1. Manager triggers audio stream
2. Control frame → agent → capture/audio_{platform}.go:
   ffmpeg -f dshow -i audio="{mic}" -ar 16000 -ac 1
          -c:a libopus -b:a 16k -f ogg pipe:1
   → reads Opus-encoded OGG chunks from stdout
   → wraps in protocol.BuildFrame(Audio, opus_bytes)
   → sends via WebSocket

3. NestJS relays Audio frames to manager's socket
4. Browser:
   → decodes Opus via Web Audio API
   → renders audio waveform visualization (AudioContext + AnalyserNode)
   → plays audio through speakers
```

---

### Flow D: GPS Sync from Mobile → Live Map

```
1. React Native (expo-location background task, every 30s):
   Location.startLocationUpdatesAsync("gps-task", {
     accuracy: Accuracy.Balanced,
     timeInterval: 30000,
     distanceInterval: 10
   })
   → GPS point stored in WatermelonDB (offline-first)

2. Every 2 min (or on WiFi):
   WatermelonDB.query(GpsPoint, Q.where("synced", false))
   → POST /api/v1/gps/batch [array of points]

3. NestJS GPS module:
   → writes to PostgreSQL gps_locations table
   → server-side geofence check:
       SELECT * FROM geofences WHERE org_id = $1
       FOR each point:
         distance = haversine(point.lat, point.lng, fence.lat, fence.lng)
         IF distance <= fence.radius AND employee NOT clocked_in:
           → INSERT time_entries (clock_in event)
           → push notification via FCM/APNs

4. SQS-style worker (daily job):
   → aggregate gps_locations into routes table (JSONB)
   → compute distance_km, duration_min per employee per day
```

---

### Flow E: Analytics Aggregation (Never Computed Live)

```
Background worker (runs every 1 hour via NestJS @nestjs/schedule):

1. Read raw activity_events for last hour per org
2. Categorize apps (productive / neutral / distracting) per org's policy
3. Compute productivity score:
   score = (productive_minutes / total_active_minutes) * 100
4. INSERT INTO productivity_scores (employee_id, org_id, date, hour, score)
5. UPDATE app_usage_summary (upsert daily totals)
6. PUBLISH Valkey: invalidate cache for affected orgs

Manager opens analytics page:
→ Next.js RSC fetches /api/v1/analytics/scores
→ NestJS: GET FROM Valkey cache (5 min TTL)
→ If cache miss: SELECT from productivity_scores table (pre-built, fast)
→ Never queries raw activity_events table (too slow at millions of rows)
```

---

## 6. Desktop Agent — Deep Dive

### Repository Structure (Actual Files)

```
apps/agent/
├── cmd/
│   ├── agent/
│   │   └── main.go              ← main agent: capture + stream + sync orchestration
│   └── watchdog/
│       ├── main_windows.go      ← Windows Service watchdog
│       └── main_other.go        ← macOS LaunchAgent / Linux systemd watchdog
│
└── internal/
    ├── capture/
    │   ├── activity.go          ← interface: GetActiveWindow()
    │   ├── activity_windows.go  ← Win32 API via CGO
    │   ├── activity_darwin.go   ← NSWorkspace + Accessibility API
    │   ├── activity_linux.go    ← X11 via xgb library
    │   ├── screenshot_*.go      ← kbinani/screenshot cross-platform
    │   ├── screen_image_*.go    ← in-memory capture for streaming
    │   ├── idle_*.go            ← idle detection per platform
    │   ├── input.go             ← goroutine-safe keystroke/mouse counter
    │   ├── camera_windows.go    ← ffmpeg DirectShow webcam
    │   ├── camera_darwin.go     ← ffmpeg AVFoundation webcam
    │   ├── camera_linux.go      ← ffmpeg V4L2 webcam
    │   ├── audio_windows.go     ← ffmpeg DirectShow mic
    │   ├── audio_darwin.go      ← ffmpeg AVFoundation mic
    │   ├── audio_linux.go       ← ffmpeg ALSA mic
    │   └── resize.go            ← JPEG compression utility
    │
    ├── stream/
    │   ├── protocol.go          ← binary frame format (8-byte header + payload)
    │   ├── client.go            ← nhooyr.io/websocket binary WS client
    │   ├── manager.go           ← orchestrates screen/camera/audio modes
    │   ├── delta.go             ← 16×16 block delta encoder
    │   └── recorder.go          ← optional MP4 session recording
    │
    ├── buffer/
    │   ├── db.go                ← SQLite lifecycle (modernc.org/sqlite)
    │   └── events.go            ← ActivityEvent, ScreenshotRecord schema
    │
    ├── sync/
    │   ├── client.go            ← HTTP client, health check, org config fetch
    │   ├── register.go          ← invite token → auth token registration
    │   ├── uploader.go          ← batch flush: activity, keystrokes, screenshots
    │   └── s3.go                ← presigned B2 upload
    │
    ├── config/
    │   ├── config.go            ← env vars + org config override
    │   └── identity.go          ← OrgID + EmployeeID persistence
    │
    ├── platform/                ← OS-specific paths, version helpers
    └── keychain/
        └── keychain.go          ← OS keychain (go-keyring)
```

### Two-Process Watchdog Design

```
OS Service Registration:
  Windows: Windows Service (main_windows.go)
  macOS:   LaunchAgent plist
  Linux:   systemd unit file

WATCHDOG PROCESS (always running, registered as OS service):
  Loop:
    1. Check if agent process is alive (PID file)
    2. If dead → restart within 3 seconds
    3. Check for agent updates (GET /api/v1/agent/version)
    4. If new version available:
       a. Download new binary to tmp path
       b. Verify SHA256 hash
       c. Swap binary (atomic rename)
       d. Restart agent
       e. Keep old binary 24h for rollback

AGENT PROCESS (spawned by watchdog):
  Concurrent goroutines:
    1. screenshotLoop()   → every 5 min: capture → SQLite → upload to B2
    2. activityLoop()     → every 10s: GetActiveWindow → SQLite
    3. keystrokeLoop()    → every 60s: flush input counter → SQLite
    4. idleLoop()         → detect idle threshold → SQLite event
    5. syncLoop()         → every 30s: flush SQLite → POST API batch
    6. streamManager()    → idle until server sends "start_stream" control frame
    7. heartbeatLoop()    → every 30s: send Heartbeat frame if streaming
```

### Streaming Binary Protocol (Actual Implementation)

```
Frame format (stream/protocol.go):

Byte 0:     Version  (1 byte)  = 0x01
Byte 1:     Type     (1 byte)
              0x01 = ScreenDelta
              0x02 = ScreenFull
              0x03 = Camera (MJPEG frame)
              0x04 = Audio  (Opus chunk)
              0x05 = Heartbeat
              0x06 = ACK
              0x07 = Control (JSON payload)
Bytes 2-3:  Reserved (2 bytes) = 0x00 0x00
Bytes 4-7:  PayloadLen (uint32, big-endian)
Bytes 8+:   Payload

ScreenDelta payload:
  Bytes 0-3:  width  (uint32)
  Bytes 4-7:  height (uint32)
  Bytes 8-N:  bitfield (ceil(numBlocks/8) bytes) — 1 bit per 16×16 block
  After bitfield: JPEG data for each changed block in order

ScreenFull payload:
  Full JPEG of entire screen

Control payload:
  JSON: { "action": "start_grid" | "start_full" | "stop_streaming"
              | "session_timeout" | "bandwidth_cap_exceeded"
              | "reduce_fps", ... }
```

### Delta Encoding — Why It Saves 80% Bandwidth

```
Without delta:
  1920×1080 screen at JPEG q=60 ≈ 150–300 KB per frame
  At 5 FPS: 750 KB – 1.5 MB/sec = 2.7–5.4 GB/hour

With delta encoding (stream/delta.go):
  Divide 1920×1080 into 16×16 blocks = 8,100 blocks
  Hash each block (fast xxhash-like comparison)
  Typical office work: only 5–15% of blocks change per frame
  Send bitfield (1,013 bytes) + only changed blocks

  Example: 5% blocks changed = 405 blocks
    405 × (small JPEG ~1 KB) = ~405 KB per frame set
    At 1 FPS: 405 KB/sec = 1.4 GB/hour
    At 5 FPS: but most frames have 0–1% change = ~50 KB/frame typical

Actual measured: ~90 MB/hour total for active office session
```

### Offline-First SQLite Buffer

```
Event captured → INSERT INTO events_buffer (data, type, synced=0, retries=0)
                 SQLite ACID guarantees no partial writes

Background sync (every 30s):
  SELECT * FROM events_buffer WHERE synced=0 ORDER BY created_at LIMIT 100
  → POST /api/v1/monitoring/batch
  → On HTTP 200:
      UPDATE events_buffer SET synced=1, synced_at=NOW() WHERE id IN (...)
  → On HTTP 4xx (bad request):
      UPDATE events_buffer SET retries=retries+1 WHERE id IN (...)
      IF retries >= 3: mark as failed (do not retry — data is bad)
  → On HTTP 5xx or network error:
      Exponential backoff: 30s → 1m → 5m → 15m → 1h → max

Cleanup (daily):
  DELETE FROM events_buffer WHERE synced=1 AND synced_at < NOW() - 7 days
  DELETE FROM events_buffer WHERE retries >= 3 AND created_at < NOW() - 1 day

Disk cap:
  IF disk_usage > 500 MB:
    DELETE oldest synced records first
    DELETE oldest failed records if still over cap
```

---

## 7. Streaming Architecture — Deep Dive

### End-to-End Streaming Path

```
Go Agent                 Oracle VM1 (NestJS)              Manager Browser
   │                           │                                │
   │──── WSS Binary ──────────▶│                                │
   │  (nhooyr.io/websocket)    │◀──── WSS (Socket.io) ─────────│
   │                           │                                │
   │  1. Agent connects with   │  streaming.gateway.ts          │
   │     Bearer JWT token      │  authenticates agent           │
   │                           │                                │
   │  2. Manager triggers:     │  Manager sends:                │
   │                           │  socket.emit("start_stream",   │
   │                           │    { employee_id, mode })      │
   │                           │                                │
   │                           │  Gateway:                      │
   │                           │  → validate manager owns org   │
   │                           │  → check bandwidth cap         │
   │                           │  → PUBLISH Valkey:             │
   │                           │    agent_{employee_id} {action}│
   │                           │                                │
   │◀─── Control Frame ────────│                                │
   │  { action: "start_full",  │                                │
   │    session_id, fps: 5 }   │                                │
   │                           │                                │
   │  3. Agent starts capture: │                                │
   │  Screen: delta.go         │                                │
   │  Camera: ffmpeg → MJPEG   │                                │
   │  Audio:  ffmpeg → Opus    │                                │
   │                           │                                │
   │──── Binary Frames ───────▶│                                │
   │  ScreenDelta(payload)     │  gateway.ts receives frame:    │
   │  Camera(jpeg_bytes)       │  → route by frame type         │
   │  Audio(opus_bytes)        │  → relay to manager socket     │
   │  Heartbeat every 30s      │  → track bandwidth per session │
   │                           │  → if cap hit: send control    │
   │                           │                               │
   │                           │────── socket.emit ───────────▶│
   │                           │  ("stream_frame", {           │
   │                           │    type, session_id, data })  │
   │                           │                               │
   │                           │  live-page-client.tsx:        │
   │                           │  • Screen: apply delta to     │
   │                           │    <canvas>                   │
   │                           │  • Camera: render MJPEG       │
   │                           │  • Audio: Web Audio API +     │
   │                           │    waveform visualization     │
```

### Why Streaming Goes Through NestJS (Not Peer-to-Peer)

A peer-to-peer WebRTC approach was considered. NestJS relay was chosen because:

| Factor | WebRTC P2P | NestJS Relay (Our Choice) |
|---|---|---|
| NAT traversal | Requires STUN/TURN servers (~$20/month) | Not needed — agent connects outbound to server |
| Signaling complexity | Complex SDP negotiation | Simple control frame JSON |
| Multi-viewer (1 agent → N managers) | Complex mesh or SFU | NestJS broadcast to room trivially |
| Bandwidth accounting | Very difficult | Count bytes at relay point — trivial |
| Auth per stream | Complex DTLS setup | JWT on WebSocket handshake — same as REST |
| Oracle egress cost | Same or more (TURN) | Covered by 10 TB/month free |
| Implementation time | 2–3 weeks | 3–5 days (already built) |

**Decision: NestJS relay wins on simplicity, cost, and multi-viewer support.**

### Bandwidth Cost of Streaming

```
Per session per hour:
  Screen (1 FPS, delta encoded):  ~54 MB/hour
  Camera (10 FPS, 320×240 MJPEG): ~28 MB/hour
  Audio (Opus 16kbps):            ~7 MB/hour
  Total (all 3 active):           ~90 MB/hour

Oracle egress free tier: 10 TB/month
At what user count does streaming exhaust egress?

  Assume 5% of users stream 2 hr/day × 22 working days:
  Per user: 5% × 2 hr × 22 × 90 MB = 198 MB/month
  10 TB ÷ 198 MB = 51,515 users

Streaming is free up to ~51,000 concurrent users on Oracle free tier.
```

---

## 8. Backend API — Deep Dive

### NestJS Module Architecture (Actual)

```
apps/api/src/
├── modules/
│   ├── auth/              JWT login, refresh, OAuth, MFA, token blacklist
│   ├── organizations/     Org CRUD, settings, subscription validation
│   ├── users/             CRUD, roles (admin/manager/employee), invites
│   ├── monitoring/        Screenshot metadata, activity events, app usage
│   ├── streaming/         ← KEY MODULE
│   │   ├── streaming.gateway.ts    Socket.io WebSocket gateway
│   │   ├── streaming.service.ts    Session management, bandwidth tracking
│   │   ├── streaming.controller.ts REST: org config, session history
│   │   └── streaming.module.ts     Module registration
│   ├── time-tracking/     Timesheets, clock in/out, approvals
│   ├── projects/          Kanban, tasks, milestones
│   ├── gps/               Location ingest, geofence eval, route agg
│   ├── analytics/         Productivity scores, summaries, exports
│   ├── integrations/      Slack, Jira, Asana, webhooks
│   ├── notifications/     Email (Brevo), push (FCM/APNs), in-app
│   └── billing/           Stripe webhooks, seat management
│
├── common/
│   ├── guards/
│   │   ├── auth.guard.ts          JWT verification + blacklist check
│   │   ├── roles.guard.ts         admin | manager | employee
│   │   └── tenant.guard.ts        org exists + subscription active
│   ├── interceptors/
│   │   ├── logging.interceptor.ts  request/response logging
│   │   ├── response.interceptor.ts standard JSON shape
│   │   └── timeout.interceptor.ts  30s request timeout
│   ├── filters/
│   │   └── global-exception.filter.ts  never exposes stack traces
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── tenant.decorator.ts
│   │   └── roles.decorator.ts
│   └── middleware/
│       ├── tenant.middleware.ts    SET LOCAL app.current_org per request
│       └── rate-limiter.middleware.ts  Redis INCR per tenant per min
│
├── database/
│   ├── entities/
│   │   ├── organization.entity.ts
│   │   ├── user.entity.ts
│   │   ├── activity-event.entity.ts
│   │   ├── screenshot.entity.ts
│   │   ├── stream-session.entity.ts  ← streaming sessions, bandwidth used
│   │   ├── gps-location.entity.ts
│   │   └── ... (20+ entities total)
│   └── migrations/
│       ├── 001_initial_schema.ts
│       ├── 010_streaming_schema.ts   ← stream_sessions table
│       └── ...
│
└── infrastructure/
    ├── b2/                  Presigned URL generation (AWS SDK S3-compatible)
    ├── valkey/              Cache service, pub/sub (ioredis)
    ├── queue/               Job queue via Valkey lists
    ├── websocket/
    │   └── redis-io.adapter.ts  @socket.io/redis-adapter for multi-process
    └── mailer/              Brevo SMTP
```

### Request Lifecycle — Every Step

```
Incoming HTTP request to NestJS:

1. NGINX  → forwards to NestJS worker process

2. Rate Limiter (middleware)
   → Redis INCR: key = "ratelimit:{org_id}:{minute}"
   → If count > 1,000: 429 Too Many Requests

3. Auth Guard
   → verify JWT signature
   → check Redis blacklist (logged out tokens)
   → attach user to request

4. Tenant Guard
   → verify org exists in DB
   → verify subscription status = active
   → if expired: 402 Payment Required

5. Roles Guard
   → check user.role matches @Roles() decorator

6. Tenant Middleware
   → SET LOCAL app.current_org = '{org_id}' on DB connection
   → PostgreSQL RLS now active for this connection

7. Validation Pipe
   → class-validator on all DTOs
   → strict: no unknown properties accepted

8. Controller → Service
   → TypeORM query (RLS auto-applied, no extra WHERE org_id needed)
   → Valkey cache-aside (GET → if miss → query DB → SET with TTL)
   → Publish to Valkey pub/sub if real-time update needed
   → Enqueue to job queue if async work needed

9. Response Interceptor
   → wrap in { success: true, data: ..., meta: { pagination } }

10. Global Exception Filter (if error thrown)
    → log full error to Sentry
    → return { success: false, error: "human readable message" }
    → NEVER expose stack trace or internal details
```

### WebSocket Gateway (streaming.gateway.ts) — Key Logic

```typescript
@WebSocketGateway({ namespace: '/ws', cors: true })
export class StreamingGateway {

  // Agent connects → join agent room
  @SubscribeMessage('agent_connect')
  handleAgentConnect(client: Socket, { employee_id }) {
    client.join(`agent_${employee_id}`)
    // store client → employee mapping
  }

  // Manager starts stream
  @SubscribeMessage('start_stream')
  async handleStartStream(client: Socket, { employee_id, mode }) {
    // verify manager owns this employee's org
    const session = await this.streamingService.createSession(...)
    // send control frame to agent
    this.server.to(`agent_${employee_id}`).emit('control', {
      action: `start_${mode}`, session_id, fps: 5
    })
    // put manager in session room
    client.join(`session_${session.id}`)
  }

  // Agent sends binary frame → relay to manager
  @SubscribeMessage('stream_frame')
  handleStreamFrame(client: Socket, frame: Buffer) {
    const { type, sessionId, payload } = parseFrame(frame)
    // track bandwidth
    this.streamingService.trackBandwidth(sessionId, payload.length)
    // relay to all managers watching this session
    this.server.to(`session_${sessionId}`).emit('stream_frame', {
      type, data: payload
    })
  }
}
```

---

## 9. Web Dashboard — Deep Dive

### App Router Structure (Actual)

```
apps/web/app/
├── (auth)/
│   ├── login/page.tsx          ← login form
│   └── register/page.tsx       ← registration
│
├── (dashboard)/
│   ├── layout.tsx              ← sidebar + header
│   ├── analytics/page.tsx      ← productivity charts
│   ├── alerts/page.tsx         ← alert rules config
│   ├── gps/page.tsx            ← GPS map + route playback
│   ├── integrations/page.tsx   ← Slack/Jira/webhook config
│   ├── live/
│   │   ├── page.tsx            ← Server Component (auth check)
│   │   └── live-page-client.tsx ← Client Component (streaming UI)
│   ├── monitoring/page.tsx     ← agent status, screenshot grid
│   ├── projects/
│   │   ├── page.tsx            ← project list
│   │   └── [id]/page.tsx       ← Kanban board
│   ├── settings/
│   │   ├── billing/page.tsx    ← Stripe portal
│   │   ├── organization/page.tsx
│   │   └── users/page.tsx
│   └── time-tracking/page.tsx  ← timesheets, clock widget
│
└── api/auth/[...nextauth]/route.ts ← NextAuth handler
```

### Key Frontend Libraries & Why Each

| Library | Used For | Why This Library |
|---|---|---|
| **Next.js 14 App Router** | Framework, SSR, routing | Server Components reduce JS bundle, fast first load |
| **shadcn/ui + Radix UI** | All UI components | Unstyled primitives + Tailwind = full control, accessible |
| **TanStack Query** | Server state, API caching | Background refetch, optimistic updates, stale-while-revalidate |
| **Zustand** | Client state (sidebar, modals) | < 1KB, no boilerplate, no context provider hell |
| **socket.io-client v4.8.3** | Live updates + streaming | Matches server Socket.io, automatic reconnection |
| **React Hook Form + Zod** | All forms | Performant (uncontrolled), Zod schema shared with NestJS DTOs |
| **Recharts + Tremor** | Productivity charts | Recharts for custom, Tremor for dashboard-style pre-built charts |
| **dnd-kit** | Kanban drag-and-drop | Modern, accessible, no jQuery dependency (unlike react-beautiful-dnd) |
| **TanStack Table** | Data tables (virtual scroll) | Handles 10,000+ row tables without performance issues |
| **Mapbox GL JS** | GPS live map + route playback | Vector tiles, smooth animations, programmatic route drawing |
| **Sonner** | Toast notifications | 1KB, framework-agnostic, beautiful defaults |
| **NextAuth.js** | Auth session management | Integrates with Next.js App Router, supports JWT + OAuth |
| **Axios** | HTTP client | Interceptors for JWT attach + refresh, consistent error handling |

### Live Streaming UI (live-page-client.tsx)

```typescript
"use client"

// Connects to NestJS Socket.io
const socket = io(process.env.NEXT_PUBLIC_WS_URL, {
  auth: { token: session.accessToken }
})

// Receives binary stream frames
socket.on("stream_frame", ({ type, data, session_id }) => {
  if (type === SCREEN_FULL) {
    // draw full JPEG to canvas
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }))
    ctx.drawImage(img, 0, 0)
  }
  if (type === SCREEN_DELTA) {
    // decode bitfield, apply only changed 16×16 blocks
    applyDeltaToCanvas(canvas, data)
  }
  if (type === CAMERA) {
    // render MJPEG frame to camera canvas
    cameraCtx.drawImage(...)
  }
  if (type === AUDIO) {
    // decode Opus via Web Audio API
    audioContext.decodeAudioData(data, buffer => {
      // play audio
      // update waveform: AudioContext.createAnalyser() → Uint8Array → canvas
    })
  }
})
```

---

## 10. All Databases — Types, Roles, Why

### Database 1 — PostgreSQL 16 (Primary Source of Truth)

**Type:** Relational SQL database  
**Hosted:** Self-hosted on Oracle VM2  
**Access:** Via PgBouncer connection pooler from NestJS  

**Tables (20+ entities):**
```
organizations, subscriptions          → tenancy and billing
users, employees                      → all people
activity_events*                      → app/URL per session (partitioned by month)
screenshots                           → metadata (b2_key, captured_at, flagged)
keystroke_intensity*                  → count per minute (partitioned)
stream_sessions                       → streaming session log, bandwidth used
time_entries, attendance, timesheets  → all time data (kept forever)
projects, tasks, milestones           → project management
gps_locations*                        → every GPS point (partitioned by month)
geofences, routes                     → geo config + daily route JSONB
productivity_scores                   → pre-aggregated hourly (rebuilt hourly)
app_usage_summary                     → pre-aggregated daily
integrations                          → encrypted tokens (Slack, Jira, etc.)

* = partitioned by month (pg_partman), old partitions dropped instantly
```

**Why PostgreSQL:**
- **Row Level Security (RLS)** — `SET LOCAL app.current_org` per request, policy on every table. Cross-tenant data leak is physically impossible at DB kernel level.
- JSONB for GPS routes (queryable, no separate points table)
- pg_partman for time-series partitioning — drop a month of data in < 1 second (DROP TABLE vs DELETE scan)
- Full ACID — time entries and billing records must never be inconsistent
- PgBouncer saves 4.8 GB RAM (20 real connections vs 1,000 pool connections)

---

### Database 2 — Valkey (Redis-compatible, In-Memory)

**Type:** In-memory key-value store with pub/sub  
**Hosted:** Self-hosted on Oracle VM2  
**Client:** ioredis  

**What's stored:**
```
Cache:        org settings, employee lists, analytics (5–15 min TTL)
Pub/sub:      org_{id} channel for live screenshot events
              agent_{employee_id} channel for streaming control frames
              session_{id} channel for streaming relay between workers
Rate limits:  INCR per tenant per minute (atomic)
Job queue:    LIST-based queue: screenshot compress, report gen, email
JWT blacklist: SET with TTL = token expiry time
```

**Why Valkey over managed options:**
- Self-hosted on Oracle free tier = $0 vs Upstash $0.20/100K commands (=$345/month at 1,000 users)
- AWS ElastiCache = $49.64/month minimum
- Redis changed to SSPL license in 2024 → Valkey is the MIT-licensed fork (Linux Foundation)
- Identical API to Redis — zero code changes

**Why pub/sub is mandatory for streaming:**
```
NestJS runs 2 worker processes (PM2 cluster mode)
Agent connects to worker #1
Manager connects to worker #2

Without Valkey pub/sub:
  Agent sends frame → worker #1 receives it
  Manager is on worker #2 → never gets the frame

With @socket.io/redis-adapter + Valkey:
  Agent sends frame → worker #1 receives it
  Worker #1 PUBLISH Valkey session_{id} frame
  Worker #2 SUBSCRIBE → gets frame → emits to manager's socket
  Streaming works regardless of which worker handles each connection
```

---

### Database 3 — SQLite (Desktop Agent Offline Buffer)

**Type:** Embedded relational database  
**Hosted:** On employee's PC (inside Go agent binary)  
**Driver:** modernc.org/sqlite (pure Go, no CGO)  

**Tables:**
```
events_buffer    (id, type, data_json, synced, retries, created_at, synced_at)
screenshots_buf  (id, b2_key, local_path, synced, retries, captured_at)
```

**Why SQLite:**
- ACID on disk — crash recovery via WAL journal. No event ever lost.
- Pure Go driver (modernc.org/sqlite) — compiles into single binary, no CGO, no DLL on Windows
- 7-day offline survival with < 500 MB disk usage (auto-pruned)
- Efficient batch reads: `SELECT WHERE synced=0 LIMIT 100` uses index

---

### Database 4 — WatermelonDB (Mobile Offline Buffer)

**Type:** SQLite-backed offline-first database for React Native  
**Hosted:** On employee's mobile phone  

**Tables:**
```
gps_points    (lat, lng, accuracy, battery, recorded_at, synced)
clock_events  (type, timestamp, location, synced)
task_updates  (task_id, status, updated_at, synced)
```

**Why WatermelonDB:**
- Built exactly for offline-first React Native — lazy loading, sync protocol built-in
- Conflict resolution: server timestamp wins (configurable)
- Background-thread processing — UI thread never blocked by DB operations

---

### Database 5 — Backblaze B2 (Object Storage)

**Type:** S3-compatible object storage  
**Hosted:** Backblaze Cloud  

**What's stored:**
```
screenshots/{org_id}/{employee_id}/{timestamp}.jpg
thumbnails/{org_id}/{employee_id}/{timestamp}_thumb.jpg
reports/{org_id}/{date}_report.pdf
agent-binaries/windows/timechamp-agent-{version}.exe
selfies/{org_id}/{employee_id}/{attendance_id}.jpg
```

**Why B2:**
- $0.006/GB/month vs AWS S3 $0.023/GB — **74% cheaper**
- Cloudflare Bandwidth Alliance → zero egress cost for all downloads
- S3-compatible API → AWS SDK works unchanged
- Class A uploads (all PUT requests) → **always free**

---

## 11. All Cloud Services — What, Why, How

### Oracle Cloud (Compute + Storage + Network)

**What we use:**

| Service | Spec | Role |
|---|---|---|
| A1 ARM VM1 | 2 OCPU / 12 GB | NestJS API + PgBouncer + NGINX + PM2 |
| A1 ARM VM2 | 2 OCPU / 12 GB | PostgreSQL + Valkey + Next.js + NGINX |
| Block Storage | 200 GB NVMe | VM boot vols (2×50 GB) + PostgreSQL data (100 GB) |
| Object Storage | 20 GB | Agent binary distribution (auto-update) |
| VCN | Private network | VM1 → VM2 via private IP (DB never exposed to internet) |
| NLB | 1 Network Load Balancer | Routes HTTPS/WSS to VM1, health checks |
| Egress | 10 TB/month | All API responses, WebSocket streams |

**Why Oracle over AWS/GCP/Azure:**

| Provider | Free Compute | Duration |
|---|---|---|
| **Oracle A1** | **4 OCPU + 24 GB RAM ARM** | **Forever** |
| AWS | 1 vCPU + 1 GB | 12 months only |
| GCP | 0.25 vCPU + 1 GB | Forever |
| Azure | 1 vCPU + 0.75 GB | 12 months only |

Oracle gives 24× more RAM than any competitor — permanently. AWS/Azure free tiers expire after 12 months.

**How it's configured:**
```
VM1 (internet-facing):
  Security list: allow TCP 443 from 0.0.0.0/0 (HTTPS)
                 allow TCP 80 from 0.0.0.0/0 (redirect to 443)
                 deny everything else from internet

VM2 (private only):
  Security list: allow TCP 5432 from VM1 private IP only (PostgreSQL)
                 allow TCP 6379 from VM1 private IP only (Valkey)
                 deny all internet access

NLB → VM1 health check: GET /health → expect 200
PM2 on VM1: cluster mode, 2 NestJS workers, auto-restart
PM2 on VM2: single Next.js process + Valkey process
```

---

### Backblaze B2 (File Storage)

**What we use:**
- One bucket: `timechamp-files` with Cloudflare CDN connected
- Lifecycle rule: auto-delete objects older than 90 days (screenshots prefix)
- CORS config: allow PUT from agent origins (for presigned uploads)

**How presigned upload works:**
```
Agent → POST /api/v1/monitoring/screenshot-url
NestJS (AWS SDK S3 client, B2 endpoint):
  const command = new PutObjectCommand({ Bucket, Key, ContentType })
  const url = await getSignedUrl(s3Client, command, { expiresIn: 900 })
  return { url, key }

Agent → PUT {jpeg_bytes} directly to B2 via presigned URL
  ← API server NEVER receives the file
  ← API server bandwidth = only tiny JSON (< 200 bytes per request)

Agent → POST /api/v1/monitoring/screenshot-confirm { key }
NestJS → INSERT into screenshots table (metadata only)
```

**Cost impact:**
- 1,000 users × 2,112 screenshots/month = 2,112,000 uploads
- Upload cost: **$0** (Class A always free)
- Storage: 2,112,000 × 80 KB = 165 GB/month cap (90-day retention)
- Storage cost: 165 GB × $0.006 = **$0.99/month**
- Download cost: **$0** (Cloudflare CDN serves all files)

---

### Cloudflare (CDN + DNS + DDoS + SSL)

**What we use:**
- DNS: domain → Oracle NLB IP
- SSL: Cloudflare issues and terminates TLS (Let's Encrypt backend, free)
- CDN: serves B2 screenshots/reports to browsers (zero egress)
- DDoS: Layer 3/4/7 protection included in free plan
- Page rules: cache B2 content aggressively (1 week TTL for screenshots)

**What Cloudflare does NOT do for us:**
- Does NOT proxy WebSocket streams — streaming WSS goes direct: browser → Cloudflare → Oracle NLB → NestJS
- Does NOT store our data
- Free plan ToS §2.8: prohibits using CDN as video/audio stream host. Our streams go through Oracle VMs directly, not Cloudflare CDN. Correct.

---

### Brevo (Transactional Email)

**What we use:**
- SMTP relay for all outbound email
- Templates: welcome, weekly report, alerts, billing notifications

**Free tier: 9,000 emails/month (300/day) — covers up to ~750 users**

**How it's integrated:**
```
NestJS mailer/brevo.service.ts:
  Uses nodemailer with Brevo SMTP credentials
  Templates stored as HTML strings in NestJS (no external template engine)
  Queue worker calls brevo.service.sendEmail() — never inline in request
```

---

### Stripe (Payment Processing)

**What we use:**
- Subscription products (per-seat monthly plan)
- Stripe webhooks → NestJS billing module
- Customer portal (hosted by Stripe — zero custom billing UI needed)

**How billing works:**
```
New org signs up:
  → create Stripe Customer
  → create Stripe Subscription (product: "timechamp_monthly", qty: seats)

Add employee (seat):
  → stripe.subscriptions.update({ items: [{ quantity: seats+1 }] })
  → Stripe prorates automatically

Remove employee:
  → stripe.subscriptions.update({ items: [{ quantity: seats-1 }] })

Failed payment:
  → Stripe retries 3× over 7 days
  → NestJS receives "invoice.payment_failed" webhook
  → NestJS sets org.subscription_status = "past_due"
  → TenantGuard returns 402 Payment Required on all API calls

Stripe fees: 2.9% + $0.30 (international) or ~2% (India domestic)
```

---

### GitHub Actions (CI/CD)

**Pipeline:**
```
On push to master:

1. Test job:
   - go test ./... (agent tests)
   - npm run test (NestJS unit tests)
   - npm run lint

2. Build job:
   - go build -o timechamp-agent-windows.exe (Windows cross-compile)
   - docker build api
   - npm run build (Next.js)

3. Deploy job:
   - SSH to Oracle VM1
   - Pull latest Docker image OR git pull + pm2 reload
   - Run TypeORM migrations (npm run migration:run)
   - SSH to Oracle VM2: pm2 reload next-js

Total CI time: ~5 minutes
Free tier: 2,000 min/month → covers 400 deployments/month
```

---

## 12. Technology Tradeoffs — Why Each Choice

### Go vs Everything Else for Desktop Agent

| | Go | Python | Node/Electron | Rust | C++ |
|---|---|---|---|---|---|
| Binary size | ~10 MB ✅ | 50+ MB + runtime ❌ | 150+ MB ❌ | ~5 MB ✅ | ~5 MB ✅ |
| RAM usage | < 50 MB ✅ | 100–300 MB ❌ | 200+ MB ❌ | < 30 MB ✅ | < 30 MB ✅ |
| CPU usage | < 1% ✅ | ~2–5% ❌ | ~3–8% ❌ | < 0.5% ✅ | < 0.5% ✅ |
| Cross-platform | One codebase ✅ | One codebase ✅ | One codebase ✅ | One codebase ✅ | Platform-specific ❌ |
| OS APIs | Full access ✅ | Full access ✅ | Limited ❌ | Full access ✅ | Full access ✅ |
| Dev speed | Fast ✅ | Fast ✅ | Fast ✅ | Slow ❌ | Very slow ❌ |
| **Winner** | **✅** | ❌ | ❌ | Close 2nd | ❌ |

**Go wins** on the combination of dev speed + performance. Rust would be slightly faster but the learning curve and compile times make it slower to build.

---

### nhooyr.io/websocket vs gorilla/websocket for Streaming

| | nhooyr.io/websocket | gorilla/websocket |
|---|---|---|
| Binary frame support | Native ✅ | Manual ❌ |
| Context cancellation | Built-in ✅ | Manual ❌ |
| Maintained | Active ✅ | Archived (2023) ❌ |
| API simplicity | Clean ✅ | Verbose ❌ |

**nhooyr.io/websocket wins** — gorilla/websocket was archived in 2023 and requires manual binary frame handling.

---

### Socket.io vs Raw WebSocket on NestJS

| | Socket.io | Raw WebSocket |
|---|---|---|
| Room management | Built-in ✅ | Manual ❌ |
| Redis adapter | Built-in (@socket.io/redis-adapter) ✅ | Manual ❌ |
| Reconnection | Automatic ✅ | Manual ❌ |
| Binary support | v4 supports binary ✅ | Native ✅ |
| Namespace isolation | Built-in ✅ | Manual ❌ |

**Socket.io wins** — the Redis adapter for multi-process scaling alone saves 2+ weeks of implementation. Essential for streaming relay architecture.

---

### PostgreSQL vs MySQL vs MongoDB for Multi-Tenant SaaS

| | PostgreSQL | MySQL | MongoDB |
|---|---|---|---|
| Row Level Security | ✅ Kernel-level | ❌ None | ❌ None |
| JSONB queryable | ✅ | Limited | ✅ |
| Time-series partitioning | ✅ pg_partman | Limited | Limited |
| Full ACID | ✅ | ✅ | Partial |
| TypeORM support | ✅ | ✅ | ✅ |
| Multi-tenant safety | **Kernel-level** | App-only | App-only |

**PostgreSQL wins on RLS.** For multi-tenant SaaS with sensitive employee data, kernel-level isolation is non-negotiable. MySQL and MongoDB require you to trust your application code 100% of the time.

---

### Self-Hosted Valkey vs Upstash Redis

At 1,000 users, Valkey pub/sub handles:
```
Activity sync: 1,000 users × 2 cmds/sync × 2 syncs/min = 4,000 cmds/min
Streaming frames: 100 concurrent streamers × 5 frames/sec × 2 cmds = 1,000 cmds/sec

Total: ~65,000 cmds/min = 93,600,000 cmds/day

Upstash cost: 93,600,000 ÷ 100,000 × $0.20 = $187.20/day = $5,616/month ❌
Self-hosted Valkey: $0/month ✅
```

**Self-hosted Valkey wins by $5,616/month at 1,000 users.** This is not a close decision.

---

### Next.js vs SPA (Vite/CRA) for Dashboard

| | Next.js 14 | Vite/CRA SPA |
|---|---|---|
| First page load | < 500ms (SSR) ✅ | 2–4s (blank then render) ❌ |
| Server Components | Reduce JS bundle ✅ | No ❌ |
| Analytics routes | RSC = zero client JS for heavy charts ✅ | Full bundle always ❌ |
| App Router | Loading/error states built-in ✅ | Manual ❌ |
| Auth handling | Server-side redirect ✅ | Client-side flicker ❌ |

**Next.js wins** — for a dashboard with analytics, server rendering pre-built chart data is a massive performance win.

---

### Backblaze B2 vs AWS S3 vs Cloudflare R2

| | B2 | AWS S3 | Cloudflare R2 |
|---|---|---|---|
| Storage $/GB | $0.006 ✅ | $0.023 ❌ | $0.015 |
| Egress via Cloudflare | **$0** ✅ | $0.085/GB ❌ | $0 ✅ |
| S3-compatible API | ✅ | ✅ | ✅ |
| Free tier | 10 GB ✅ | None ❌ | 10 GB + ops ✅ |
| At 165 GB, 1 TB egress | **$0.93/month** ✅ | $88.80/month ❌ | $2.33/month |

**B2 + Cloudflare wins** — 95× cheaper than AWS S3 + CloudFront at 500 users.

---

*Document version: 1.0 — 2026-04-05*  
*Based on actual codebase: 44 Go files, 100+ TypeScript files*
