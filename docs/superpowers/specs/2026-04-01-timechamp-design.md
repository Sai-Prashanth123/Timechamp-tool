# Time Champ Clone — Full System Design Spec
**Date:** 2026-04-01
**Status:** Approved
**Model:** SaaS, Multi-tenant
**Scale:** MVP — up to 50 companies, ~1,000 users
**Team:** Solo developer + Claude Code
**Cloud:** AWS

---

## 1. System Overview

Time Champ clone is a full workforce intelligence SaaS platform covering:
- Desktop employee monitoring (screenshots, app tracking, activity)
- Automatic time tracking and timesheets
- Project management (Kanban, tasks, milestones)
- Field staff GPS tracking and geo-fenced attendance
- Analytics and productivity reporting dashboards
- Third-party integrations (Slack, Jira, etc.)
- Multi-tenant billing and subscription management

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| Desktop Agent | Go (native binary) | Small (~10MB), cross-platform, system-level APIs, low resource usage |
| Backend API | NestJS (Node.js + TypeScript) | Structured modules, DI, WebSocket, Swagger auto-gen |
| Web Dashboard | Next.js 14 (React, App Router) | SSR, RSC, file-based routing, performance |
| Mobile App | React Native (Expo bare workflow) | iOS + Android, background GPS, offline support |
| Primary Database | PostgreSQL (AWS RDS Multi-AZ) | Relational, RLS for multi-tenancy, strong consistency |
| Cache + Queues | Redis (AWS ElastiCache) | Cache-aside, pub/sub for WebSocket, job queues |
| Async Jobs | AWS SQS + DLQ | Screenshot processing, reports, notifications, integrations |
| File Storage | AWS S3 + CloudFront | Screenshots, exports, agent binaries |
| Email | AWS SES | Transactional email |
| Auth | JWT + NextAuth.js + Clerk (optional) | Stateless auth, MFA, OAuth |
| Payments | Stripe | Subscription billing, seat management |
| Monitoring | AWS CloudWatch + Sentry | Logs, metrics, error tracking |
| CI/CD | GitHub Actions + AWS ECS Fargate | Containerized, blue/green deployments |
| Secrets | AWS Secrets Manager | Zero secrets in code or env files |

---

## 3. Architecture

### 3.1 High-Level Diagram

```
CLIENT LAYER
  Desktop Agent (Go)  |  Web App (Next.js)  |  Mobile (React Native)
         |                     |                      |
         └─────────────────────┼──────────────────────┘
                               │
                    AWS API Gateway
              (SSL, rate limiting, DDoS)
                               │
                    NestJS API Server
                    (ECS Fargate, auto-scale)
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
     PostgreSQL RDS        Redis Cache           AWS S3
     (Multi-AZ, RLS)      (pub/sub, queues)     (files, CDN)
```

### 3.2 Multi-Tenancy

- Every table has `organization_id`
- PostgreSQL Row Level Security (RLS) enforces tenant isolation at DB level
- Tenant middleware sets `SET LOCAL app.current_org = 'org_id'` per request
- Even buggy query logic cannot leak cross-tenant data

### 3.3 Real-Time

- NestJS Socket.io gateway scoped per `organization_id`
- Redis pub/sub bridges API workers to WebSocket connections
- Managers see live: employee online/idle/offline, screenshots, clock events
- Updates throttled to max 1/sec per employee to prevent UI flooding

---

## 4. Desktop Agent (Go)

### 4.1 Two-Process Design

**Watchdog Process** (registered as OS service):
- Windows: Windows Service
- macOS: LaunchAgent (plist)
- Linux: systemd unit
- Monitors agent process health, restarts within 3 seconds of crash
- Handles auto-updates (download → verify SHA256 → swap binary → restart)
- Keeps old binary for 24h rollback

**Agent Process** (spawned by watchdog):
- Captures all monitoring data
- Buffers locally in embedded SQLite
- Syncs to API in batches

### 4.2 Data Captured

| Signal | Method | Interval |
|---|---|---|
| Screenshots | OS screenshot API | Every 5 min (configurable per org) |
| Active app + window title | OS process API | Every 10s |
| Website URLs | Browser extension hook | Real-time |
| Keystroke intensity (count only, not content) | OS input hook | Per minute |
| Mouse activity | OS input hook | Per minute |
| Idle detection | Input inactivity threshold | After 3 min idle |
| Clock in / clock out | User action or schedule trigger | On event |

**Privacy:** Raw keystrokes are never recorded — only count per minute. Screenshots auto-blur apps on a configurable blocklist (banking, password managers).

### 4.3 Offline-First Pipeline

```
Event captured → SQLite buffer → background goroutine flush (every 30s)
    → Internet available?
        YES → POST batch to API → mark synced → delete local record
        NO  → retain in SQLite → retry: 30s → 1m → 5m → 15m → 1h (max)
```

Survives up to 7 days offline. No data loss on crash — SQLite is ACID.

### 4.4 Resource Limits

| Resource | Hard Limit |
|---|---|
| CPU | < 1% average |
| RAM | < 50MB |
| Disk (buffer) | < 500MB (auto-prune synced records) |
| Network | Batched only, no continuous streaming |

### 4.5 API Communication

- HTTPS REST for data batches
- Screenshots uploaded via presigned S3 URLs (never through API server)
- Auth token stored in OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- Circuit breaker: 3× 5xx → switch to offline mode, pause retries for 5 min

---

## 5. Backend API (NestJS)

### 5.1 Module Structure

```
src/
├── modules/
│   ├── auth/             JWT, OAuth, MFA, refresh tokens, blacklist
│   ├── organizations/    Tenant management, settings, subscription checks
│   ├── users/            Roles (admin/manager/employee), invites, permissions
│   ├── monitoring/       Screenshot ingestion, activity events, app usage
│   ├── time-tracking/    Timesheets, clock in/out, manual entries, approvals
│   ├── projects/         Kanban board, tasks, milestones, time-per-task
│   ├── gps/              Location ingestion, geofences, route aggregation
│   ├── analytics/        Productivity scores, reports, app/site summaries
│   ├── integrations/     Slack, Jira, Asana, webhooks
│   ├── notifications/    Email (SES), push (FCM/APNs), in-app
│   └── billing/          Stripe subscriptions, seat management, webhooks
│
├── common/
│   ├── guards/           AuthGuard, RolesGuard, TenantGuard
│   ├── interceptors/     Logging, response transform, timeout
│   ├── filters/          GlobalExceptionFilter (never exposes stack traces)
│   ├── decorators/       @CurrentUser, @Tenant, @Roles, @ApiTenant
│   └── middleware/       TenantResolver, RateLimiter
│
└── infrastructure/
    ├── s3/               Presigned URL generation, file management
    ├── redis/            Cache service, pub/sub
    ├── queue/            SQS producers + consumers
    ├── websocket/        Socket.io gateway, room management
    └── mailer/           SES transactional email
```

### 5.2 Request Lifecycle

```
Request
  → Rate Limiter (Redis, 1000 req/min per tenant)
  → AuthGuard (JWT verify + blacklist check)
  → TenantGuard (org exists + subscription active)
  → RolesGuard (admin / manager / employee)
  → ValidationPipe (class-validator, strict)
  → Controller → Service
      → TypeORM (pool: 20 connections)
      → Redis cache (cache-aside, 5 min TTL)
      → SQS (async heavy work)
  → ResponseInterceptor (standardize shape)
  → GlobalExceptionFilter (catch all, never crash)
```

### 5.3 Async Queue Workers (SQS)

| Queue | Job | DLQ After |
|---|---|---|
| `screenshot-processor` | Compress, thumbnail, optional OCR | 3 retries |
| `activity-aggregator` | Roll raw events into hourly summaries | 3 retries |
| `report-generator` | Build PDF/Excel reports | 3 retries |
| `notification-sender` | Email, push, Slack | 3 retries |
| `integration-sync` | Push to Jira, Asana, etc. | 3 retries |
| `billing-events` | Stripe webhook processing | 3 retries |

All DLQs alert on message arrival.

### 5.4 API Standards

- REST versioned at `/api/v1/`
- WebSocket at `/ws` (Socket.io)
- Swagger/OpenAPI auto-generated from decorators
- Cursor-based pagination on all list endpoints
- Idempotency keys on agent upload endpoints (duplicate batches ignored)
- Presigned S3 URLs for all file operations

### 5.5 Error Resilience

| Failure | Response |
|---|---|
| DB connection lost | TypeORM auto-reconnect + circuit breaker |
| Redis down | Graceful degradation (skip cache, query DB) |
| SQS unavailable | Exponential backoff + DLQ alert |
| Unhandled exception | GlobalExceptionFilter catches, logs, returns 500 |
| Memory leak | ECS auto-restart + CloudWatch alarm |
| Graceful shutdown | SIGTERM handler, 30s drain window |

---

## 6. Web Dashboard (Next.js)

### 6.1 App Structure

```
app/
├── (auth)/login, register, forgot-password
├── (dashboard)/
│   ├── overview/           Live team activity map
│   ├── employees/[id]/     Timeline, screenshots, productivity
│   ├── time-tracking/      Timesheets, attendance, approvals
│   ├── projects/[id]/      Kanban, Gantt, task list with time
│   ├── gps/                Live map, route playback
│   ├── analytics/          Scores, app/site usage, scheduled reports
│   ├── integrations/       Connect external tools
│   ├── alerts/             Suspicious activity, threshold breaches
│   └── settings/           Org, policies, roles, billing
```

### 6.2 Frontend Libraries

| Concern | Library |
|---|---|
| UI Components | shadcn/ui + Tailwind CSS |
| Server State | TanStack Query |
| Client State | Zustand |
| Charts | Recharts + Tremor |
| Maps | Mapbox GL JS |
| Drag-and-Drop (Kanban) | dnd-kit |
| Data Tables | TanStack Table (virtual scroll) |
| Real-time | Socket.io client |
| Forms | React Hook Form + Zod |
| Auth | NextAuth.js |
| Notifications | Sonner (toasts) |

### 6.3 Performance

- Virtual scrolling on screenshot grids and large tables
- WebSocket updates throttled (max 1/sec per employee)
- Analytics served from pre-aggregated cache (SQS worker)
- React Error Boundaries on every major section
- TanStack Query auto-refetch on window focus
- Offline banner shown when connectivity lost

---

## 7. Mobile App (React Native + Expo)

### 7.1 Two Modes

- **Employee mode:** Clock in/out, GPS tracking, task updates, selfie check-in
- **Manager mode:** View team live, approve timesheets, receive alerts

### 7.2 Key Libraries

| Concern | Library |
|---|---|
| Navigation | Expo Router |
| Maps | react-native-maps + Google Maps |
| Background GPS | expo-location (background mode) |
| Offline Sync | WatermelonDB |
| Push Notifications | Expo Notifications + FCM/APNs |
| Biometrics | expo-local-authentication |
| Camera | expo-camera (selfie clock-in) |
| Secure Storage | expo-secure-store |

### 7.3 GPS Pipeline

```
Background location fires every 30s (battery-optimized)
  → Buffered in WatermelonDB
  → Batch upload every 2 min (or on WiFi)
  → API stores points, runs geofence checks server-side
```

### 7.4 Offline Strategy

All field actions (clock-in, task updates, GPS points) stored locally first.
Sync on connectivity restore. Conflict resolution: server timestamp wins.

---

## 8. Database Schema

### Core Tables

```sql
-- Tenancy
organizations       (id, name, plan, seats, created_at)
subscriptions       (id, org_id, stripe_sub_id, plan, status, seats)

-- Users
users               (id, org_id, email, role, name, avatar_url, created_at)
employees           (id, user_id, org_id, department, job_title, shift_id)

-- Monitoring
activity_events     (id, employee_id, org_id, app_name, window_title, url, started_at, ended_at)
screenshots         (id, employee_id, org_id, s3_key, thumbnail_key, captured_at, flagged)
keystroke_intensity (id, employee_id, org_id, keys_per_min, mouse_events_per_min, recorded_at)

-- Time Tracking
time_entries        (id, employee_id, org_id, project_id, task_id, started_at, ended_at, source)
attendance          (id, employee_id, org_id, clock_in, clock_out, location_lat, location_lng, selfie_key)
timesheets          (id, employee_id, org_id, week_start, total_hours, status, approved_by, approved_at)

-- Projects
projects            (id, org_id, name, description, status, deadline, created_by)
tasks               (id, project_id, org_id, assignee_id, title, status, priority, estimated_hours, due_date)
milestones          (id, project_id, org_id, name, due_date, completed_at)

-- GPS + Field
gps_locations       (id, employee_id, org_id, lat, lng, accuracy, battery_level, recorded_at)
geofences           (id, org_id, name, lat, lng, radius_meters, auto_clockin, auto_clockout)
routes              (id, employee_id, org_id, date, distance_km, duration_min, points jsonb)

-- Analytics (pre-aggregated, rebuilt hourly by SQS worker)
productivity_scores     (id, employee_id, org_id, date, hour, score, productive_mins, idle_mins)
app_usage_summary       (id, employee_id, org_id, date, app_name, category, duration_mins)

-- Integrations
integrations        (id, org_id, provider, access_token_encrypted, refresh_token_encrypted, config jsonb)

-- All tables protected by PostgreSQL RLS on org_id
```

---

## 9. Reliability Architecture

### Layers of Resilience

| Layer | Mechanism |
|---|---|
| Agent never loses data | SQLite offline buffer, ACID, 7-day retention |
| API never crashes | GlobalExceptionFilter, circuit breakers, graceful shutdown |
| DB never corrupts | Versioned migrations, always backwards-compatible, Multi-AZ |
| Jobs never dropped | SQS + DLQ + retry + alert on DLQ message |
| Infra self-heals | ECS Fargate auto-restart, health checks, CloudWatch alarms |
| Zero-downtime deploy | Blue/green on ECS, traffic shifts only after health check passes |
| Secrets never exposed | AWS Secrets Manager, auto-rotation, zero secrets in code |
| Cross-tenant leak impossible | PostgreSQL RLS enforced at DB level |

---

## 10. Build Order (Sub-Projects)

Build in this sequence — each is independently shippable:

1. **Foundation** — Org/user auth, multi-tenancy, billing (Stripe), admin shell
2. **Desktop Agent** — Go agent (Windows first), watchdog, SQLite buffer, API sync
3. **Time Tracking** — Clock in/out, timesheets, attendance, approvals
4. **Monitoring Dashboard** — Screenshots viewer, activity feed, live status
5. **Analytics** — Productivity scores, app/site reports, scheduled exports
6. **Project Management** — Kanban, tasks, milestones, time-per-task
7. **GPS + Mobile** — React Native app, background GPS, geo-fencing
8. **Integrations** — Slack, Jira, webhooks, API for third parties
9. **Agent: macOS + Linux** — Extend agent to remaining platforms
10. **Scale & Polish** — Performance tuning, advanced alerts, white-labeling
