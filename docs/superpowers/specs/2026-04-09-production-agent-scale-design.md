# Production-Grade Agent System — 110k Scale Design

**Date:** 2026-04-09  
**Status:** Approved  
**Scope:** Full redesign of TimeChamp agent + API for 110k concurrent agents

---

## 1. Requirements Summary

| Requirement | Decision |
|---|---|
| Deployment model | Multi-tenant SaaS |
| Sync frequency | 30s real-time (with ±30% jitter) |
| Screenshot interval | Per-org configurable |
| Data retention | Per-org configurable |
| Region | Single region (primary) |
| Platforms | Windows + macOS + Linux |
| Update delivery | Auto-update with staged rollout + auto-rollback |
| Auth/DB/Storage | Full Supabase (replaces PostgreSQL + S3 + JWT) |
| Observability | Prometheus + Grafana + Loki + Tempo (self-hosted) |

---

## 2. System Architecture

```
110K DESKTOP AGENTS (Windows + macOS + Linux)
         │  HTTPS + jitter (±30% of 30s)  ~3,700 req/s sustained
         ▼
LOAD BALANCER (NGINX / AWS ALB)
    │                    │
    ▼                    ▼
Go Ingestor          NestJS Web API
(3–5 pods)           (2–4 pods)
/agent/sync/*        /auth, /dashboard
/agent/hb            /analytics, /billing
/v1/crash            /projects, /orgs
    │
    ▼
Redis Streams (durable write buffer)
    │
    ▼
Supabase
├── Auth (JWT + RLS)
├── PostgreSQL (partitioned tables, TimescaleDB)
└── Storage (screenshots, agent binaries)

Observability: Prometheus → Grafana, Loki, Tempo, Alertmanager
```

---

## 3. Agent Architecture

### 3.1 Process Model

- **Tray process (Wails):** UI, registration, spawns agent with `CREATE_NEW_PROCESS_GROUP`
- **Agent process:** `signal.Ignore(os.Interrupt)`, `FreeConsole()` on Windows, writes `agent.pid`
- **monitorAgent goroutine:** polls health HTTP endpoint every 10s, restarts if dead
- **Health endpoint:** `http://127.0.0.1:27183/health` → `{"status":"ok","uptime":342}`
- **Crash reporter:** panic recovery → POST `/v1/crash` → fallback to `crash.log`

### 3.2 Permission Handling

**macOS — 3 permissions, all checked independently:**

| Permission | API | Degradation if missing |
|---|---|---|
| Screen Recording | `CGPreflightScreenCaptureAccess()` | Skip screenshots |
| Accessibility | `AXIsProcessTrustedWithOptions()` | Skip window titles, browser URLs via AX |
| Input Monitoring | IOKit | Skip keystroke counting |

- Re-check every 60s — auto-enable features when user grants permission
- First-run flow: attempt → fail → open System Preferences → log degraded state → continue

**Windows:**
- No runtime permissions needed for window/app tracking
- UAC elevation requested at install time via manifest (`requireAdministrator`)
- Handles elevated process windows without runtime prompts

### 3.3 Accurate Activity Detection

**Window + app detection:**
- Windows: `GetForegroundWindow` → `GetWindowText` → `QueryFullProcessImageName`
- macOS: `CGWindowListCopyWindowInfo` + `NSWorkspace.frontmostApplication` (requires Accessibility)
- Linux: `_NET_ACTIVE_WINDOW` via X11, `/proc` fallback for Wayland

**Browser URL detection — 3 layers:**
1. Native messaging extension (Chrome/Edge/Firefox) → exact URL, zero latency
2. Accessibility API scraping (AXUIElement macOS, UI Automation Windows) → ~200ms latency
3. Window title parsing (regex per browser) → always works, less accurate

Agent reports which layer is active via telemetry — visible in Grafana.

**Idle detection:**
- Windows: `GetLastInputInfo()`
- macOS: `CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateHIDSystemState)`
- Linux: `XScreenSaverQueryInfo()` (X11), `/proc/interrupts` fallback

**Heartbeat merge (ActivityWatch pattern — keep as-is):**
```
1s window polls → HeartbeatQueue → merge same-app events → commit at 60s → SQLite
```

### 3.4 Local Buffer

- SQLite with WAL mode enabled
- 4 tables: `activity_events`, `screenshots`, `keystroke_events`, `system_metrics`
- All rows have `synced=0/1` flag
- On sync success: mark synced, prune after `maxBufferDays`
- On sync failure: rows stay in buffer, retried next tick — **no data loss**
- Buffer survives crashes, OS reboots, network outages

### 3.5 Agent Telemetry (to Observability Stack)

Every 60s the agent reports:
- Uptime, memory, CPU, last sync success/latency, buffered row count
- Permission states (screen recording, accessibility, input monitoring)
- URL detection layer active (1/2/3)
- Agent version, OS, org, employee

### 3.6 Retry + Backoff

```
Initial interval:  2s
Max interval:      5 minutes
Multiplier:        2.0 (exponential)
Jitter:            Full jitter (0 to current interval) — prevents correlated retries
Max elapsed:       30 minutes then give up (data stays in SQLite)
Permanent errors:  400, 401, 403 — do not retry
```

---

## 4. Data Ingestion Pipeline

### 4.1 Jitter (Mandatory)

```go
// ±30% jitter on every sync interval
// 30s base → actual interval: 21s–39s
// 110k agents → ~3,700 req/s (not 110k simultaneous)
```

### 4.2 Go Ingestor Service

**Endpoints:**
- `POST /v1/ingest/activity` — batch up to 500 events
- `POST /v1/ingest/metrics` — batch up to 100 events
- `POST /v1/ingest/keystrokes` — batch up to 100 events
- `POST /v1/ingest/screenshot/url` — get presigned upload URL
- `POST /v1/ingest/screenshot/confirm` — confirm upload complete
- `POST /v1/ingest/heartbeat` — lightweight ping
- `POST /v1/crash` — unauthenticated crash report

**JWT caching (critical performance optimization):**
- Cache `sha256(token)` → `{employee_id, org_id, expires_at}` in Redis
- TTL = token expiry - 60s
- Cache hit rate ~99.9% (agents reuse token for hours)
- Auth cost: <0.1ms (hit) vs ~5ms (miss)

**Per-request flow:**
1. Verify JWT (Redis cache → Supabase verify on miss)
2. Validate payload (bounds, timestamp sanity, field presence)
3. `XADD` to Redis Stream → return 200 immediately
4. Agent never waits for DB write

### 4.3 Redis Streams

**Streams:**
- `tc:activity:ingest` — fan-out to batch-writer + realtime-broadcaster
- `tc:metrics:ingest`
- `tc:screenshots:ingest`
- `tc:keystrokes:ingest`

**Properties:**
- Durable: entries persist until ACKed — ingestor crash loses nothing
- Backpressure: stream grows if Supabase is slow — agents unaffected
- `MAXLEN ~5,000,000` entries — trim oldest on overflow (SQLite backup on agent)

### 4.4 Batch Writer

```
Flush when: ≥1000 rows accumulated OR 500ms elapsed (whichever first)
INSERT ... ON CONFLICT DO NOTHING  (idempotent — handles agent retries)
Retry: exponential backoff + jitter, max 5 attempts
Dead-letter: permanent failures → Redis dead-letter stream for manual recovery
```

**Result:** 3,700 individual agent requests → 3.7 bulk INSERTs/second to Supabase.

### 4.5 Screenshot Upload

```
Agent → POST /v1/ingest/screenshot/url → Ingestor → Supabase Storage presigned URL
Agent → PUT directly to Supabase Storage (bypasses API entirely)
Agent → POST /v1/ingest/screenshot/confirm → Ingestor → Redis Stream → DB
```

Storage path: `screenshots/{org_id}/{employee_id}/{YYYY}/{MM}/{DD}/{timestamp}.jpg`

**Compression (agent-side):** JPEG quality 60, max 1920×1080 → ~100KB avg (vs ~300KB at Q90)

---

## 5. Supabase Integration

### 5.1 Auth

- Supabase Auth replaces custom JWT system entirely
- Custom JWT claims: `{org_id, role, employee_id}` added via Auth hook
- Agent stores access token + refresh token in OS keychain
- Auto-refresh when token expires in <5 minutes
- Invite flow: admin generates magic link → employee opens tray → Supabase verifies → JWT issued

### 5.2 Database Schema (key tables)

**activity_events** — partitioned by day:
```sql
PARTITION BY RANGE (started_at)
-- Daily partitions via pg_partman
-- Index: (org_id, employee_id, started_at DESC)
-- Retention: per-org, enforced via pg_cron daily job
```

**agent_metrics** — TimescaleDB hypertable:
```sql
chunk_time_interval = 1 day
compression after 7 days (10x storage reduction)
continuous aggregate: hourly rollups (avg/max CPU, mem)
```

**screenshots** — partitioned by captured_at:
```sql
expires_at computed column (captured_at + org.screenshot_retention_days)
Daily cleanup via Supabase Edge Function
Storage path: screenshots/{org_id}/{employee_id}/{date}/{timestamp}.jpg
```

**crash_reports:**
```sql
org_id, employee_id, agent_version, os, error_type, message, stack_trace, uptime_sec
Index: (agent_version, error_type, reported_at DESC)
```

**agent_releases** — update delivery:
```sql
version, rollout_percent (1→10→50→100), status (staged|active|rolled_back)
per-platform download paths + ECDSA signatures
promoted_at, rolled_back_at, rollback_reason
```

### 5.3 Row Level Security

- Every table has RLS enabled
- Employees: see only their own rows (`employee_id = auth.uid()`)
- Managers/admins: see all rows in their org (`org_id = jwt.org_id AND role IN ('admin','manager')`)
- Go Ingestor: uses Supabase service role key — bypasses RLS for bulk inserts
- Cross-tenant data leakage impossible at DB layer even with application bugs

### 5.4 Storage RLS

- Employee upload policy: path must match `{jwt.org_id}/{auth.uid()}/...`
- Manager read policy: path org_id must match `jwt.org_id` AND role is admin/manager
- Signed URLs expire in 1 hour for downloads, 5 minutes for uploads

### 5.5 Migration Plan

- Phase 1: New installs use Supabase Auth + DB. Old agents continue.
- Phase 2: pg_dump existing DB → Supabase import. S3 → Supabase Storage sync.
- Phase 3: Old JWT guard accepts both token types (2-week window). Cutover.

---

## 6. Observability Stack

### 6.1 Components

| Component | Purpose |
|---|---|
| Prometheus | Metrics collection + storage |
| Loki | Log aggregation (agent logs, API logs) |
| Tempo | Distributed traces |
| Grafana | Dashboards + alerting UI |
| Alertmanager | Fires Slack + PagerDuty on thresholds |
| OTel Collector | Single receiver, routes to all backends |

### 6.2 Key Metrics

**Ingestor:** `tc_ingest_requests_total`, `tc_ingest_latency_ms` (histogram), `tc_active_agents`, `tc_stream_lag_entries`, `tc_jwt_cache_total`

**Agent telemetry:** uptime, mem, CPU, last sync success/latency, buffered rows, permission states, URL detection layer

**Database:** connection pool utilization, query p95 latency, table sizes, partition health

### 6.3 Grafana Dashboards

1. **Agent Fleet Health** — online/offline counts, OS distribution, version distribution, permission issues
2. **Ingestion Pipeline** — req/s, stream lag, batch writer rate, error rate, JWT cache hit
3. **Crash Analytics** — crashes by version/OS/error type, crash rate trend, stack trace browser
4. **Supabase Health** — connection pool, query latency, storage usage, partition sizes

### 6.4 Alert Rules

| Alert | Condition | Severity |
|---|---|---|
| MassAgentOffline | >5% agents offline >10min | Critical |
| AgentCrashRateHigh | Crash rate >1% in 5min window | Warning |
| StreamLagHigh | Redis stream lag >500k entries | Critical |
| IngestLatencyHigh | p95 latency >500ms for 5min | Warning |
| DBConnectionPoolExhausted | >90% pool used for 1min | Critical |

### 6.5 Agent Log Shipping

- Agent implements `io.Writer` → writes to both local file AND Loki batch
- Flush every 5s to Loki with labels: `{org_id, employee_id, agent_version, os, level}`
- Loki unreachable: silently drop logs (local file always available)

---

## 7. Update Delivery System

### 7.1 Staged Rollout

```
Stage 1:   1% of fleet  → wait 1 hour  → check crash rate
Stage 2:  10% of fleet  → wait 2 hours → check crash rate
Stage 3:  50% of fleet  → wait 4 hours → check crash rate
Stage 4: 100% of fleet  → complete
```

- Agent selection: `hash(employee_id) % 100 < rollout_percent` — consistent, deterministic
- Auto-rollback: if crash rate >2% at any stage → rollback + Slack alert
- Auto-promotion: NestJS cron every 30 minutes evaluates stage advancement

### 7.2 Agent Update Flow

1. Agent checks `/v1/update/check` every 1 hour (+ jitter)
2. Ingestor checks `agent_releases` table for applicable version
3. Agent downloads binary from Supabase Storage signed URL
4. Agent verifies ECDSA-P256 signature — rejects if invalid
5. Atomic replace: rename old → `.bak`, rename new → binary path
6. `os.Exit(0)` → tray's `monitorAgent` restarts within 10s
7. Agent POSTs `/v1/update/confirm` with new version → updates rollout tracking

### 7.3 Platform Requirements

- **Windows:** Code-signed `.exe` (DigiCert/Sectigo) — SmartScreen requires this
- **macOS:** Notarized universal binary (arm64+amd64) — Gatekeeper requires this
- **Linux:** ELF binary, systemd `Restart=always` handles restart

---

## 8. Implementation Order

1. **Agent reliability fixes** (in progress — signal handling, monitorAgent, health endpoint)
2. **Accurate capture** — macOS Accessibility API, Windows UI Automation, 3-layer URL detection
3. **Permission handling** — macOS permission check/request/degradation flow
4. **Go Ingestor service** — new service, Redis Streams, JWT caching
5. **Supabase migration** — Auth, partitioned DB schema, Storage, RLS policies
6. **Batch Writer service** — Redis Streams consumer, bulk insert to Supabase
7. **Observability stack** — Prometheus, Loki, Grafana, OTel Collector, Alertmanager
8. **Update delivery** — staged rollout controller, ECDSA signing, notarization/signing
9. **Crash reporter** — panic recovery, POST to /v1/crash, Grafana crash dashboard

---

## 9. Key Guarantees

| Concern | Guarantee | Mechanism |
|---|---|---|
| Data loss | Zero loss even on API outage | SQLite buffer on agent, Redis Streams buffer on server |
| Agent stability | Restarts within 10s of crash | monitorAgent goroutine + health HTTP ping |
| Thundering herd | Eliminated | ±30% jitter on all sync intervals |
| Cross-tenant isolation | Impossible to breach | Supabase RLS at DB layer, not app layer |
| Bad update blast radius | Max 1% of fleet | Staged rollout + auto-rollback at 2% crash rate |
| Screenshot accuracy | Per-org configurable | Org config distributed via `/v1/config` endpoint |
| Activity accuracy | 3-layer URL detection | Extension → Accessibility API → title parsing |
| Permissions (macOS) | Graceful degradation | Per-feature check, re-enable when granted |
