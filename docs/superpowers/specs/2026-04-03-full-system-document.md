# Time Champ Clone — Full System Document
**Date:** 2026-04-03  
**Status:** Approved  
**Pricing Data:** Verified 2026-04-03 from official sources  
**Author:** Sai-Prashanth + Claude Code  
**Model:** Multi-tenant SaaS  
**Target Scale:** MVP → 50 companies, ~1,000 users → 20,000+ users  
**Team:** Solo developer + Claude Code  

---

## Table of Contents

1. [What Is This Product?](#1-what-is-this-product)
2. [Full Feature List](#2-full-feature-list)
3. [Full System Architecture](#3-full-system-architecture)
4. [Technology Choices & Tradeoffs](#4-technology-choices--tradeoffs)
5. [All Databases — Types, Roles & Why](#5-all-databases--types-roles--why)
6. [Oracle Cloud — What We Use & Why Oracle Only](#6-oracle-cloud--what-we-use--why-oracle-only)
7. [Cost Reduction — How We Achieve 95%+ Savings](#7-cost-reduction--how-we-achieve-95-savings)
8. [Data Growth & Storage Scaling Strategy](#8-data-growth--storage-scaling-strategy)
9. [Full Scaling Roadmap](#9-full-scaling-roadmap)

---

## 1. What Is This Product?

**Time Champ Clone** is a **B2B SaaS workforce intelligence platform**. It is a commercial product where companies (organizations) pay a monthly subscription and get complete visibility into how their employees are spending their working time — what apps they use, how productive they are, where they are physically located, and how their projects are progressing.

### The Problem It Solves

| Problem | Solution |
|---|---|
| Managers cannot see what remote employees are doing | Desktop agent captures screenshots, apps, URLs every few minutes |
| Manual timesheets are inaccurate and slow | Automatic time tracking from agent activity — no manual entry |
| No proof of work for billing clients | Screenshot history + detailed activity reports per employee |
| Field staff attendance is guesswork | GPS tracking + geo-fenced auto clock-in/out |
| Projects go over budget with no early warning | Time tracked per task — see actual vs estimated hours in real time |
| Scattered tools (Slack, Jira, HR, attendance) | All-in-one: monitoring + time + projects + GPS + reports |

### Who Buys This

- IT companies tracking remote developers
- BPOs and call centers monitoring agents
- Construction and logistics companies tracking field workers
- Staffing agencies billing clients by the hour
- Any business paying hourly employees and needing proof of work

### Business Model

- Multi-tenant SaaS — each company is a completely isolated tenant
- Pricing: ₹499/user/month (~$6 USD) targeting Indian SMBs
- Stripe subscription billing with per-seat management
- Admin portal for platform owner, separate portal per company

---

## 2. Full Feature List

### Feature 1 — Desktop Employee Monitoring

A lightweight Go binary runs silently on every employee's Windows PC (Mac and Linux later). It captures:

| Signal | How It's Captured | Interval |
|---|---|---|
| Screenshots | OS screenshot API → compressed JPEG → uploaded to Backblaze B2 | Every 5 minutes (configurable per org) |
| Active app + window title | OS process enumeration API | Every 10 seconds |
| Website URLs | Browser extension hook (Chrome, Firefox, Edge) | Real-time |
| Keystroke count (not content) | OS input hook — count only, content never recorded | Per minute |
| Mouse activity count | OS input hook | Per minute |
| Idle detection | Input inactivity threshold | After 3 minutes of no activity |
| Clock in / Clock out | User action or schedule trigger or geo-fence event | On event |

**Privacy safeguards built in:**
- Raw keystrokes are **never recorded** — only the count per minute
- Screenshots auto-blur apps on a configurable per-org blocklist (banking, password managers, etc.)
- Employees see an indicator in the system tray when monitoring is active
- Managers can configure a privacy window (e.g., no monitoring after 6 PM)

**Two-process watchdog design:**
- **Watchdog process** runs as a Windows Service — monitors agent health, restarts within 3 seconds of any crash, handles auto-updates
- **Agent process** spawned by watchdog — does all the actual capturing and syncing
- Offline-first: all events buffered in local SQLite, synced in batches, survives 7 days without internet

---

### Feature 2 — Automatic Time Tracking

- Timesheets auto-built from captured activity data — no manual data entry required
- **Clock in / clock out** via desktop agent, mobile app, or geo-fence auto-trigger
- **Manual time entry** with reason field — for meetings, phone calls, offline work
- Manager **approval workflow** — review, approve, or reject timesheets with comments
- **Attendance records** — clock in timestamp, clock out timestamp, work location coordinates, optional selfie photo
- Overtime calculations, shift definitions, late arrival flagging
- Calendar view, weekly view, custom date range

---

### Feature 3 — Real-Time Monitoring Dashboard

- Manager opens web dashboard → sees **live status** of every employee: Online / Idle / Offline
- **Live screenshot grid** — most recent screenshot per employee, auto-refreshing
- Click any employee → **full timeline** for the day: which app, which website, for how long, with screenshots
- **Activity feed** — real-time stream of events as they come from agents
- WebSocket updates throttled to **maximum 1 update per second per employee** — prevents UI flooding at scale
- **Live streaming mode** (advanced) — real-time WebSocket screen view without waiting 5 minutes for next screenshot

---

### Feature 4 — Analytics & Productivity Reports

- **Productivity score** per employee per day, per week, per month (0–100 scale)
- Score computed from: active app time, app categories (productive/neutral/distracting), idle percentage, task completion
- App usage breakdown — which apps used, duration, categorized automatically
- Website usage breakdown — productive sites vs social media vs entertainment
- **Comparison views** — team average vs individual, this week vs last week, this month vs last month
- **Scheduled PDF/Excel exports** — auto-generated weekly/monthly, emailed to manager
- Top performers list, least active list, trend charts over time
- All analytics pre-aggregated by background workers — never queried live from raw DB

---

### Feature 5 — Project Management

- **Kanban boards** with drag-and-drop task management (dnd-kit)
- Tasks with: assignee, priority (Critical/High/Medium/Low), estimated hours, actual hours, due date, status
- **Milestones** with deadlines — see which milestone is at risk
- **Time tracked per task** automatically — agent detects task context from window titles + user selection
- Gantt-style timeline view for project managers
- Time budget vs actual spend per project — see overruns early

---

### Feature 6 — GPS Tracking & Field Staff

- Mobile app tracks employee location **every 30 seconds** using battery-optimized background GPS
- **Geo-fences** — admin defines virtual boundaries around offices/sites with a radius in meters
- Auto clock-in when employee enters a geo-fence, auto clock-out on exit — no manual action required
- **Route playback** — replay the exact path a delivery or field employee traveled during the day on a map
- **Live map** — see all field staff positions right now, with status (moving / stationary / idle)
- Distance traveled per day, time at each location
- Battery level reported with each GPS point for field staff management

---

### Feature 7 — Mobile App (iOS + Android)

**Employee mode:**
- Clock in / clock out with one tap
- Selfie check-in with front camera (stored in B2)
- GPS tracking runs in background automatically
- View assigned tasks, update task status
- View personal time entries and productivity summary
- Full offline support — all actions stored locally, synced on reconnect

**Manager mode:**
- View live team status on mobile
- Approve or reject timesheets with a swipe
- See live map of field staff
- Receive push alerts for policy violations, idle alerts, attendance issues

---

### Feature 8 — Multi-Tenant Billing & Admin

- Each company = completely isolated tenant. Zero data crossover possible.
- **Stripe subscription** — monthly or annual billing, per-seat pricing
- Add/remove employee seats → Stripe proration handled automatically
- Admin portal (platform owner level) → see all tenants, revenue, system health, usage stats
- Company admin portal → manage employees, roles, policies, billing, screenshot policy
- Failed payment → Stripe auto-retries → subscription downgraded if still failed → data preserved for 30 days

---

### Feature 9 — Alerts & Notifications

- Policy violation alerts (employee on blocked app, excessive idle time, working outside defined hours)
- Attendance alerts (missed clock-in, late arrival, early departure)
- Productivity threshold alerts (score falls below configured minimum)
- All alerts: **email via Brevo**, **push notification via FCM/APNs**, **in-app toast**
- Alert batching — max 1 alert per employee per 15 minutes to prevent email floods
- Manager configures which alerts fire per org

---

### Feature 10 — Integrations

- **Slack** — daily team activity summaries, alerts pushed to Slack channels
- **Jira** — sync tasks bidirectionally, log time entries back to Jira automatically
- **Asana** — task and time sync
- **Webhooks** — subscribe to any platform event and push to any external system
- **Public REST API** — documented via Swagger, for custom third-party integrations

---

## 3. Full System Architecture

### High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                │
│                                                                        │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────┐  │
│  │  Go Desktop     │  │  Next.js Web     │  │  React Native       │  │
│  │  Agent          │  │  Dashboard       │  │  Mobile App         │  │
│  │  Windows/Mac/   │  │  (Manager /      │  │  (Employee /        │  │
│  │  Linux          │  │   Admin)         │  │   Manager)          │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────────┬──────────┘  │
└───────────┼────────────────────┼───────────────────────┼─────────────┘
            │ HTTPS (batch sync) │ HTTPS + WSS            │ HTTPS (GPS)
            │                   │                        │
            ▼                   ▼                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   CLOUDFLARE (Always Free)                            │
│          DNS | SSL Termination | DDoS Protection | CDN               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                 ORACLE VM1 — 2 OCPU / 12 GB ARM                      │
│                 (NestJS API + PgBouncer + NGINX)                      │
│                                                                        │
│   NGINX                                                                │
│     └─→ NestJS API (cluster: 2 worker processes)                      │
│           ├── Auth Module (JWT, refresh, MFA, OAuth)                  │
│           ├── Tenant Module (org isolation, subscription)             │
│           ├── Monitoring Module (screenshot, activity)                │
│           ├── Time Tracking Module (timesheets, clock in/out)         │
│           ├── Projects Module (Kanban, tasks, milestones)             │
│           ├── GPS Module (locations, geofences, routes)               │
│           ├── Analytics Module (scores, reports)                      │
│           ├── Integrations Module (Slack, Jira, webhooks)             │
│           ├── Notifications Module (email, push)                      │
│           ├── Billing Module (Stripe webhooks, seat management)       │
│           └── WebSocket Gateway (Socket.io, org-scoped rooms)        │
│                   ↓                                                    │
│           PgBouncer (connection pool → PostgreSQL)                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ Internal VPC (private network)
             ┌───────────────┼─────────────────┐
             ▼               ▼                 ▼
┌───────────────────┐  ┌──────────────┐  ┌────────────────────────────┐
│  ORACLE VM2       │  │ BACKBLAZE B2 │  │ CLOUDFLARE CDN             │
│  2 OCPU / 12 GB   │  │ Object Store │  │ Serves B2 files to browser │
│                   │  │              │  │ Zero egress cost            │
│  PostgreSQL 16    │  │ Screenshots  │  │ (Bandwidth Alliance)        │
│  (primary DB,     │  │ Thumbnails   │  └────────────────────────────┘
│   RLS enforced)   │  │ PDF reports  │
│                   │  │ Agent bins   │  ┌────────────────────────────┐
│  Valkey           │  │              │  │ BREVO                      │
│  (Redis-compat,   │  │ ← Presigned  │  │ Transactional email        │
│   cache+pubsub)   │  │   URLs only. │  │ 9,000/month free           │
│                   │  │   API server │  └────────────────────────────┘
│  Next.js SSR      │  │   never      │
│  (web dashboard)  │  │   touches    │  ┌────────────────────────────┐
│                   │  │   files.     │  │ STRIPE                     │
│  NGINX            │  └──────────────┘  │ Subscription billing       │
│  (static assets)  │                   │ Seat management            │
└───────────────────┘                   │ Webhook processing          │
                                        └────────────────────────────┘
```

---

### Request Lifecycle — Every Step Explained

#### A. Desktop Agent → API (Data Sync Every 30 Seconds)

```
1. Go agent captures event (screenshot / app change / keystrokes)
2. Writes to local SQLite buffer (ACID — no data lost on crash)
3. Background goroutine fires every 30 seconds:

   FOR SCREENSHOTS:
   a. Agent calls POST /api/v1/monitoring/screenshot-url
   b. NestJS returns a presigned Backblaze B2 upload URL (expires in 15 min)
   c. Agent uploads JPEG directly to B2 — API server never receives the file
   d. Agent calls POST /api/v1/monitoring/screenshot-confirm { b2_key, captured_at }
   e. NestJS writes screenshot metadata to PostgreSQL
   f. NestJS publishes event to Valkey pub/sub channel: org_{id}
   g. Socket.io gateway picks it up, pushes to all managers watching that org
   h. Manager's browser shows new screenshot appear live

   FOR ACTIVITY EVENTS:
   a. Agent POSTs batch of up to 100 events to /api/v1/monitoring/batch
   b. Idempotency key header prevents duplicate processing if batch is sent twice
   c. NestJS pipeline:
      → Rate limiter (Redis INCR: 1,000 req/min per tenant)
      → JWT AuthGuard (verify token + blacklist check)
      → TenantGuard (org exists + subscription active)
      → ValidationPipe (class-validator, strict schema)
      → Service writes to PostgreSQL via TypeORM
      → Publishes to Valkey pub/sub
   d. Agent marks SQLite records as synced, deletes after 7 days
```

#### B. Manager Opens Dashboard (Web Browser)

```
1. Browser → Cloudflare → NGINX → Next.js on Oracle VM2
2. Next.js App Router:
   - Server Components fetch initial data server-side (no API roundtrip from browser)
   - Layout renders with employee list already populated
   - Client hydrates with TanStack Query
3. Socket.io client connects to wss://api.domain.com/ws
   - Joins room: org_{organization_id}
   - Receives live events pushed by Valkey pub/sub
4. Screenshots clicked by manager:
   - Browser requests: cdn.domain.com/screenshots/{key}.jpg
   - Cloudflare checks edge cache (>95% hit rate expected)
   - Cache HIT → serves from Cloudflare edge in ~20ms, zero Oracle/B2 cost
   - Cache MISS → Cloudflare fetches from B2, caches, serves (still zero egress cost)
5. Analytics page requested:
   - Served from pre-aggregated Valkey cache (5 min TTL)
   - Cache miss → query PostgreSQL productivity_scores + app_usage_summary tables
   - These are pre-built by SQS workers hourly — never computed live from raw events
```

#### C. Heavy Background Jobs (Async Queue Workers)

```
SCREENSHOT PROCESSING:
  Agent confirms upload → NestJS enqueues: { job: "process-screenshot", key }
  Worker: compress thumbnail, optional OCR for text search
  Worker: stores thumbnail_key in PostgreSQL screenshots table
  On 3 failures → Dead Letter Queue → alert fires to engineer

REPORT GENERATION:
  Manager clicks "Export Report" → NestJS enqueues: { job: "generate-report", orgId, range }
  Worker: queries PostgreSQL analytics tables
  Worker: builds PDF/Excel using library
  Worker: uploads to B2 → stores download URL in DB
  Worker: sends email via Brevo with presigned download link

ANALYTICS AGGREGATION (runs hourly):
  Worker: reads raw activity_events from last hour
  Worker: computes productivity scores per employee per hour
  Worker: rolls up app usage into app_usage_summary
  Worker: writes to productivity_scores + app_usage_summary tables
  Worker: invalidates Valkey cache for affected orgs
  Effect: dashboard analytics are always < 1 hour stale, never slow

STRIPE BILLING WEBHOOK:
  Stripe sends event → NestJS receives at /api/v1/billing/webhook
  NestJS enqueues event (not processed inline)
  Worker: updates subscription status in DB
  Worker: if payment failed → flag org → send warning email via Brevo
  Worker: if subscription cancelled → schedule data deletion in 30 days
```

#### D. Mobile GPS Pipeline

```
expo-location background task fires every 30 seconds
  → GPS point stored in WatermelonDB (local SQLite on phone)
Every 2 minutes (or immediately on WiFi connect):
  → Batch POST to /api/v1/gps/batch (up to 240 points at once)
  → NestJS writes to PostgreSQL gps_locations table
  → Server-side geofence check:
      For each org's geofences:
        distance = haversine(point.lat, point.lng, fence.lat, fence.lng)
        if distance <= fence.radius_meters AND employee not clocked in:
          → trigger auto clock-in event
          → send push notification via FCM/APNs
  → SQS worker aggregates points into routes table daily (JSONB)
```

#### E. Multi-Tenancy Flow (How Data Is Isolated)

```
Every HTTP request arrives:
  → TenantMiddleware:
      1. Extracts JWT from Authorization header
      2. Decodes: { userId, orgId, role }
      3. Executes on PostgreSQL connection:
         SET LOCAL app.current_org = 'org_uuid_here';
  → TypeORM query executes, e.g.:
         SELECT * FROM activity_events WHERE employee_id = $1
  → PostgreSQL RLS policy intercepts automatically:
         CREATE POLICY tenant_isolation ON activity_events
           USING (org_id = current_setting('app.current_org')::uuid);
  → PostgreSQL silently adds: AND org_id = 'org_uuid_here'
  → Even if NestJS code has a bug and omits the WHERE clause,
    PostgreSQL returns ONLY the current tenant's rows.
  → Cross-tenant data leak is physically impossible at the DB kernel level.
```

---

### NestJS Module Structure

```
src/
├── modules/
│   ├── auth/              JWT, OAuth, MFA, refresh tokens, blacklist
│   ├── organizations/     Tenant management, settings, subscription checks
│   ├── users/             Roles (admin/manager/employee), invites, permissions
│   ├── monitoring/        Screenshot ingestion, activity events, app usage
│   ├── time-tracking/     Timesheets, clock in/out, manual entries, approvals
│   ├── projects/          Kanban board, tasks, milestones, time-per-task
│   ├── gps/               Location ingestion, geofences, route aggregation
│   ├── analytics/         Productivity scores, reports, summaries
│   ├── integrations/      Slack, Jira, Asana, webhooks
│   ├── notifications/     Email (Brevo), push (FCM/APNs), in-app
│   └── billing/           Stripe subscriptions, seat management, webhooks
│
├── common/
│   ├── guards/            AuthGuard, RolesGuard, TenantGuard
│   ├── interceptors/      Logging, response transform, timeout
│   ├── filters/           GlobalExceptionFilter (never exposes stack traces)
│   ├── decorators/        @CurrentUser, @Tenant, @Roles
│   └── middleware/        TenantResolver, RateLimiter
│
└── infrastructure/
    ├── b2/                Presigned URL generation, file management
    ├── valkey/            Cache service, pub/sub
    ├── queue/             Job queue producers + consumers
    ├── websocket/         Socket.io gateway, room management
    └── mailer/            Brevo transactional email
```

---

### Web Dashboard App Structure (Next.js)

```
app/
├── (auth)/
│   ├── login/
│   ├── register/
│   └── forgot-password/
├── (dashboard)/
│   ├── overview/           Live team activity map, online/idle/offline
│   ├── employees/[id]/     Timeline, screenshots, productivity score
│   ├── time-tracking/      Timesheets, attendance, approvals
│   ├── projects/[id]/      Kanban, Gantt, task list with time
│   ├── gps/                Live map, route playback
│   ├── analytics/          Scores, app/site usage, exports
│   ├── integrations/       Connect Slack, Jira, webhooks
│   ├── alerts/             Activity violations, threshold breaches
│   └── settings/           Org, policies, roles, billing
```

---

### Database Schema (Core Tables)

```sql
-- Tenancy
organizations       (id, name, plan, seats, created_at)
subscriptions       (id, org_id, stripe_sub_id, plan, status, seats)

-- Users
users               (id, org_id, email, role, name, avatar_url, created_at)
employees           (id, user_id, org_id, department, job_title, shift_id)

-- Monitoring
activity_events     (id, employee_id, org_id, app_name, window_title, url, started_at, ended_at)
screenshots         (id, employee_id, org_id, b2_key, thumbnail_key, captured_at, flagged)
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
routes              (id, employee_id, org_id, date, distance_km, points jsonb)

-- Analytics (pre-aggregated hourly, never computed live)
productivity_scores     (id, employee_id, org_id, date, hour, score, productive_mins, idle_mins)
app_usage_summary       (id, employee_id, org_id, date, app_name, category, duration_mins)
app_usage_monthly       (id, employee_id, org_id, month, app_name, total_mins)

-- Integrations
integrations        (id, org_id, provider, access_token_encrypted, refresh_token_encrypted, config jsonb)

-- All tables protected by PostgreSQL RLS policy on org_id
```

---

## 4. Technology Choices & Tradeoffs

### Go for Desktop Agent

**Why Go won:**

| Go Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| Single ~10 MB binary, no runtime needed | Electron / Node.js | 150–200 MB binary, 300+ MB RAM at idle |
| < 1% CPU, < 50 MB RAM | Python | Needs runtime installed, 100–300 MB RAM, slow startup |
| Goroutines for concurrent capture + sync | Java / Kotlin | JVM startup latency, 200+ MB minimum RAM |
| Cross-compiles to Windows/Mac/Linux | C++ | Equal performance but 5× longer development time, memory safety risks |
| Excellent OS API access (screenshot, input hooks, keychain) | Rust | Equally good but steeper learning curve, longer build times |

**Key tradeoff accepted:** Go is not as fast as C++ or Rust in raw throughput. For a monitoring agent that captures screenshots every 5 minutes and syncs data every 30 seconds, "fast enough" is what matters — not maximum throughput.

---

### NestJS for Backend API

**Why NestJS won:**

| NestJS Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| TypeScript-first — shared types with Next.js frontend | Plain Express | No structure enforced, becomes unmaintainable at scale |
| Dependency injection — fully testable services | Fastify | Good performance but less opinionated, more boilerplate for enterprise patterns |
| Built-in Socket.io WebSocket gateway | Django / FastAPI | Python adds a second language to maintain; async is bolted-on in Django |
| Guards/Interceptors/Pipes — auth, validation, logging out of the box | Go (Gin/Fiber) | Faster throughput but no ORM maturity, no auto-generated Swagger |
| Auto-generated Swagger/OpenAPI from decorators | Spring Boot | Java startup time, heavy memory footprint, slower development |

**Key tradeoff accepted:** NestJS is slower in raw req/sec than plain Fastify or Go HTTP servers. At our scale (33 req/sec at 1,000 users), this is completely irrelevant. Structured code beats raw throughput every time for a solo developer.

---

### PostgreSQL as Primary Database

**Why PostgreSQL won:**

| PostgreSQL Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| **Row Level Security (RLS)** — kernel-level tenant isolation | MySQL | No RLS; tenant isolation must be enforced 100% in application code — one bug = data leak |
| JSONB columns — flexible GPS route storage, queryable | MongoDB | No RLS at all; multi-tenancy is application-only; horizontal scale comes at operational complexity cost |
| Full ACID for financial + time data | CockroachDB | Distributed but complex, expensive, overkill for MVP scale |
| TypeORM + versioned migrations | DynamoDB | NoSQL is wrong fit for relational workforce data with complex joins |
| pg_partman for time-series partitioning | InfluxDB | InfluxDB is specialized for metrics but lacks relational joins for our mixed data |

**The decisive factor:** PostgreSQL Row Level Security (RLS) is the only database feature that physically prevents cross-tenant data leakage at the DB kernel level. No application-layer solution is as safe. For a multi-tenant SaaS handling sensitive employee data, this is non-negotiable.

---

### Valkey (Redis fork) for Cache + Pub/Sub

**Why Valkey won:**

| Valkey Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| Pub/sub bridges multiple NestJS workers to WebSocket connections | No cache at all | Every live update queries PostgreSQL directly — dies at 100 concurrent users |
| Atomic INCR + EXPIRE for rate limiting | Memcached | No pub/sub, no sorted sets, no persistence options |
| In-memory — cache reads 0.1ms vs 5–50ms from PostgreSQL | RabbitMQ | Heavier, separate system, not also a cache |
| Valkey = open-source MIT license (Redis changed to SSPL in 2024) | Redis (managed) | Redis Cloud $7+/month minimum for 30 MB; Upstash gets expensive at volume (see cost section) |
| Self-hosted on Oracle free tier = $0/month | AWS ElastiCache | $49.64/month for cache.t3.medium — not justified at MVP |

**The pub/sub use case is mandatory:** When a desktop agent syncs data to NestJS worker process #1, and the manager is connected via WebSocket to worker process #2, Valkey pub/sub is what delivers the live update between them. Without it, live dashboard only works with a single server process.

---

### Next.js 14 for Web Dashboard

**Why Next.js won:**

| Next.js Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| Server-side rendering — fast first page load, no blank spinner | CRA / Vite SPA | Client-only, slow initial load, bad performance on slow connections |
| React Server Components — smaller JS bundle sent to browser | Angular | Heavier bundle, steeper learning curve, less dashboard library ecosystem |
| App Router colocates layouts, loading states, error boundaries | Vue / Nuxt | Would work but React has more dashboard-specific libraries (Recharts, Tremor, dnd-kit) |
| Shared TypeScript with NestJS backend — shared types, no duplication | Remix | Excellent alternative but smaller ecosystem, less community resources |

---

### React Native + Expo for Mobile

**Why Expo won:**

| Expo Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| One codebase → iOS + Android, 2× faster development | Native Swift + Kotlin | Two separate codebases, two teams needed |
| expo-location: battle-tested background GPS on both platforms | Flutter | Less mature background task and push notification ecosystem |
| expo-camera, expo-local-authentication, expo-secure-store ready-made | Ionic | Web-based rendering, poor background task performance, GPS reliability issues |
| Bare workflow allows ejecting to native when needed | PWA | Apple restricts background GPS on iOS PWAs |

---

### Backblaze B2 + Cloudflare for File Storage

**Why B2 + Cloudflare won:**

| B2 + Cloudflare Advantage | Competitor That Lost | Why Competitor Lost |
|---|---|---|
| Storage $0.006/GB vs AWS S3 $0.023/GB — **74% cheaper** | AWS S3 + CloudFront | S3: 4× more expensive; CloudFront egress: $0.085/GB |
| **Zero egress cost** via Cloudflare Bandwidth Alliance | AWS S3 + CloudFront | CloudFront egress at 1 TB = $85/month extra |
| S3-compatible API — zero code change to switch later | Cloudflare R2 only | R2 is $0.015/GB (2.5× more expensive than B2) |
| Presigned URLs — client uploads direct, API server never touches files | Self-hosted MinIO | MinIO requires its own server maintenance, no CDN built-in |

---

## 5. All Databases — Types, Roles & Why

### Database 1 — PostgreSQL (Relational, Primary Source of Truth)

**Type:** Relational database (SQL)  
**Hosted:** Self-hosted on Oracle VM2  
**Connection pooler:** PgBouncer in front  

**What is stored:**
- All user accounts, organizations, subscriptions
- All employee monitoring data (activity events, screenshots metadata, keystroke counts)
- All time tracking data (entries, attendance, timesheets)
- All project management data (projects, tasks, milestones)
- All GPS data (locations, geofences, routes)
- Pre-aggregated analytics (productivity scores, app usage summaries)
- Integration tokens (encrypted at rest)

**Why PostgreSQL is the correct choice here:**
- **Row Level Security** — multi-tenancy enforced at DB kernel. No bug can leak data between tenants.
- **JSONB** — GPS route points stored as queryable JSON without needing a separate points table
- **Full ACID** — clock in/out events and billing records must never be in an inconsistent state
- **pg_partman** — time-series tables (activity_events, gps_locations) partitioned by month. Old partitions dropped instantly with `DROP TABLE`, no slow DELETE scans.
- **PgBouncer math:** NestJS opens 1,000 connections → PgBouncer multiplexes to 20 real DB connections → saves ~4.8 GB RAM (each PostgreSQL connection = ~5 MB)

**Connection flow:**
```
NestJS (1,000 possible connections)
  → PgBouncer (pool: 20 connections)
    → PostgreSQL (handles 20 concurrent queries)
```

---

### Database 2 — Valkey / Redis (In-Memory, Cache + Message Bus)

**Type:** In-memory key-value store with pub/sub  
**Hosted:** Self-hosted on Oracle VM2  

**What is stored:**
- Hot analytics cache (5 min TTL) — employee lists, productivity scores, org settings
- JWT blacklist — revoked tokens stored until expiry
- Rate limiting counters — INCR per tenant per minute, atomic
- Pub/sub channels — one channel per org_id for live WebSocket events
- Background job queues — screenshot compress jobs, report generate jobs, email send jobs

**Why Valkey (not managed Redis Cloud or Upstash):**

Upstash cost math at 1,000 users:
```
1,000 users syncing every 30s = 2 Redis commands per sync × 2/min = 4,000 cmds/min
4,000 × 60 min × 24 hr × 30 days = 172,800,000 commands/month
At Upstash $0.20/100K: 172,800,000 ÷ 100,000 × $0.20 = $345.60/month
```
Self-hosted Valkey on Oracle free tier = **$0/month**. Savings: **$345.60/month** at 1,000 users.

---

### Database 3 — SQLite (Embedded Offline Buffer on Employee PC)

**Type:** Embedded relational database  
**Hosted:** On the employee's own machine (part of the Go agent binary)  

**What is stored:**
- All captured events not yet synced to the API (activity events, keystroke counts, screenshot references)
- Sync state per record (pending / syncing / synced)
- Retry counter and last attempt timestamp per batch

**Why SQLite:**
- **ACID on disk** — if agent process crashes mid-write, SQLite journal ensures zero partial records. No event is ever lost.
- **Zero dependency** — embedded in Go binary via `modernc.org/sqlite` (pure Go, no CGO). No installation required on employee PC.
- **7-day offline survival** — agent can be offline a full week, all data is preserved and syncs when internet returns
- **Auto-pruned** — records deleted after successful sync. Disk usage stays < 500 MB permanently.

**Why not just write to a log file:**
- Log files have no ACID guarantees — crash = potentially corrupted or incomplete log
- SQLite allows indexed queries (`SELECT WHERE synced = 0 LIMIT 100`) — efficient batch reads
- SQLite allows clean `DELETE WHERE synced = 1 AND synced_at < 7 days ago` — no file rotation needed

---

### Database 4 — WatermelonDB (Embedded Offline Buffer on Mobile)

**Type:** Embedded SQLite-backed offline-first database for React Native  
**Hosted:** On the employee's mobile phone  

**What is stored:**
- GPS location points not yet uploaded
- Clock in/out events pending sync
- Task status updates made offline
- Conflict resolution metadata (server timestamp wins)

**Why WatermelonDB over AsyncStorage or direct SQLite:**
- **Offline-first by design** — built specifically for mobile apps that must work without internet
- **Lazy loading** — only loads queried records into JavaScript memory, not the entire table
- **Built-in sync protocol** — handles merge conflicts, supports `updatedAt` timestamp-based conflict resolution
- **React Native integration** — native-side processing, UI thread never blocked by DB queries
- **Underlying SQLite** — same ACID guarantees as the desktop agent's buffer

---

### Database 5 — Backblaze B2 (Object Storage, Binary Files)

**Type:** Object storage (not a traditional database, but a storage layer)  
**Hosted:** Backblaze Cloud  

**What is stored:**
- Screenshots — JPEG files, ~80 KB each
- Screenshot thumbnails — ~5 KB each (generated by background worker)
- PDF / Excel report exports
- Desktop agent binaries for auto-update distribution
- Employee selfie check-in photos

**Why B2 is treated as a storage database here:**
- Accessed via S3-compatible REST API (PUT/GET/DELETE)
- Supports lifecycle policies (auto-delete after N days)
- Metadata queryable (file listing, prefixes, custom metadata)
- At $0.006/GB, it is the cheapest reliable object storage available

---

## 6. Oracle Cloud — What We Use & Why Oracle Only

### What We Use in Oracle Cloud

| Oracle Service | How We Use It | Cost |
|---|---|---|
| A1 ARM Compute — VM1 (2 OCPU / 12 GB) | NestJS API + PgBouncer + NGINX + Queue Workers | **$0 forever** |
| A1 ARM Compute — VM2 (2 OCPU / 12 GB) | PostgreSQL + Valkey + Next.js + NGINX | **$0 forever** |
| Block Storage — 200 GB | VM1 boot (50 GB) + VM2 boot (50 GB) + PostgreSQL data (100 GB) | **$0 forever** |
| Object Storage — 20 GB | Agent binary distribution for auto-updates | **$0 forever** |
| Virtual Cloud Network (VCN) | Private internal network between VM1 and VM2 | **$0 forever** |
| Network Load Balancer | Routes all HTTPS traffic to VM1, health checks | **$0 forever** |
| Egress — 10 TB/month | WebSocket traffic, API responses, Next.js page loads | **$0 forever** |
| **Total Oracle Cost** | | **$0/month** |

---

### Why Oracle Cloud and NOT AWS, GCP, Azure, or DigitalOcean

This is the single most important infrastructure decision in the project. The comparison:

| Cloud | Free Compute Spec | Duration | Monthly Equivalent Value |
|---|---|---|---|
| **Oracle Cloud A1** | **4 OCPU + 24 GB RAM (ARM)** | **Forever — guaranteed** | **~$120–180/month** |
| AWS Free Tier | 1 vCPU + 1 GB RAM (t2.micro) | 12 months only, then billed | ~$8/month |
| GCP Free Tier | 0.25 vCPU + 1 GB RAM (e2-micro) | Forever | ~$6/month |
| Azure Free Tier | 1 vCPU + 0.75 GB RAM (B1s) | 12 months only, then billed | ~$7/month |
| DigitalOcean | No free compute | N/A | N/A |
| Hetzner | No free compute | N/A | N/A |

Oracle gives **24× more RAM** than GCP's free tier and **24× more RAM** than AWS's free tier. No other cloud provider is even in the same category for free compute.

---

### What the Oracle A1 ARM Ampere Processor Delivers

The A1 instances use **Ampere Altra** ARM processors — purpose-built for cloud server workloads:

- Each OCPU = **1 physical ARM core** (not a timeshared vCPU)
- NestJS + Node.js on 2 OCPU: handles ~**2,000–5,000 REST req/sec**
- Socket.io concurrent connections: ~**5,000–10,000** per process on 2 GB RAM
- PostgreSQL on 2 OCPU with PgBouncer: handles ~**500–2,000 queries/sec**
- At 1,000 active users: agent syncs = ~33 req/sec, screenshot uploads = ~3 req/sec → **< 5% of VM1 capacity used**

NestJS, PostgreSQL, Valkey, and Next.js all have official ARM64 builds. Zero emulation, full native performance.

---

### VM Architecture — Why Two VMs, Not One

```
VM1 (NestJS + NGINX + PgBouncer):
  - Internet-facing — receives all HTTP/WebSocket traffic
  - Security group: allows port 80, 443 from internet only
  - Communicates to VM2 only via private VCN (not internet)

VM2 (PostgreSQL + Valkey + Next.js):
  - NOT internet-facing — no public IP exposure
  - Security group: accepts connections from VM1 private IP only
  - PostgreSQL port 5432 is never accessible from internet
  - Valkey port 6379 is never accessible from internet

Benefit: Even if VM1 is fully compromised, attacker cannot directly reach
the database because VM2 has no public internet endpoint.
```

---

### Oracle Limitations and How We Handle Each

| Limitation | Our Mitigation |
|---|---|
| A1 capacity often shows "Out of capacity" in popular regions | Use **Hyderabad (ap-hyderabad-1)** — confirmed A1 availability. Provision the moment account is created. |
| Single region (no geographic redundancy at free tier) | Daily automated backups to Backblaze B2 ($0 upload cost). Restore time < 2 hours if region fails. |
| 200 GB block storage limit | 90-day data retention policy + partitioning keeps PostgreSQL under 100 GB permanently. |
| Only 10 Mbps on free Load Balancer | Cloudflare terminates SSL and distributes traffic. Oracle NLB is last hop only. |
| Egress $25/TB after 10 TB | Screenshots bypass Oracle entirely (direct B2 via presigned URLs + Cloudflare CDN). Only API + WebSocket use Oracle egress. 10 TB supports ~51,500 concurrent streaming users. |
| Oracle account could be suspended | Architecture is fully portable. Can move to 2× Hetzner CX32 (~$17.40/month) in under 1 day. |

---

## 7. Cost Reduction — How We Achieve 95%+ Savings

### What a Standard AWS Stack Would Cost at 500 Users

| AWS Service | Configuration | Monthly Cost |
|---|---|---|
| ECS Fargate — NestJS API | 2 vCPU + 4 GB RAM, always-on | $35.55 |
| ECS Fargate — Next.js SSR | 1 vCPU + 2 GB RAM, always-on | $17.78 |
| ECS Fargate — Queue Workers | 1 vCPU + 2 GB RAM, always-on | $17.78 |
| RDS PostgreSQL db.t3.medium | 2 vCPU, 4 GB RAM, Multi-AZ | $105.12 |
| ElastiCache Redis cache.t3.medium | 2 vCPU, 3 GB RAM | $49.64 |
| S3 storage — 165 GB | $0.023/GB | $3.80 |
| CloudFront egress — 1 TB | $0.085/GB | $85.00 |
| API Gateway — 10M requests | $3.50/million | $35.00 |
| SES email — 7,500 emails | $0.10/1,000 | $0.75 |
| NAT Gateway — 50 GB/month | $0.045/GB + $0.045/hr | $40.00 |
| Application Load Balancer | Always-on | $18.00 |
| CloudWatch — logs + metrics | Standard tier | $15.00 |
| Secrets Manager — 10 secrets | $0.40/secret/month | $4.00 |
| **Total AWS Monthly** | | **~$427/month** |

### What Our Stack Costs at 500 Users (Verified Pricing 2026-04-03)

| Our Service | Configuration | Monthly Cost |
|---|---|---|
| Oracle VM1 — NestJS + NGINX | 2 OCPU / 12 GB ARM | **$0** |
| Oracle VM2 — PostgreSQL + Valkey | 2 OCPU / 12 GB ARM | **$0** |
| Oracle Block Storage | 200 GB NVMe | **$0** |
| Oracle Network Load Balancer | 1 free NLB | **$0** |
| Oracle Egress | First 10 TB/month | **$0** |
| Backblaze B2 storage — 165 GB | 10 GB free + 155 GB × $0.006 | **$0.93** |
| Cloudflare CDN — screenshot delivery | Unlimited via Bandwidth Alliance | **$0** |
| Brevo email — 7,500 emails | Under 9,000/month free tier | **$0** |
| Valkey (self-hosted on Oracle) | Runs on Oracle free VM | **$0** |
| Stripe | 2.9% + $0.30/txn, no monthly fee | **$0** (revenue share, not infra cost) |
| **Total Our Monthly** | | **~$0.93** |

### Direct Comparison

| Users | AWS Stack | Our Stack | Monthly Savings | % Saved |
|---|---|---|---|---|
| 10 | ~$427 | $0.00 | $427 | **100%** |
| 100 | ~$427 | $0.14 | $426.86 | **99.97%** |
| 500 | ~$427 | $0.93 | $426.07 | **99.78%** |
| 1,000 | ~$450 | $31.00 | $419.00 | **93.1%** |
| 2,000 | ~$500 | $44.00 | $456.00 | **91.2%** |
| 5,000 | ~$750 | $81.00 | $669.00 | **89.2%** |

---

### The 5 Cost Reduction Levers — Explained

#### Lever 1 — Oracle Always Free Compute = $0 Instead of $241/month

```
Equivalent AWS services:
  ECS Fargate (NestJS)  = $35.55/month
  ECS Fargate (Next.js) = $17.78/month
  ECS Fargate (Workers) = $17.78/month
  EC2 t3.xlarge equiv   = $170.00/month
  ────────────────────────────────────
  Total compute AWS     = ~$241/month
  Oracle compute        = $0
  Saving               = $241/month
```

#### Lever 2 — Backblaze B2 + Cloudflare = 99% Cheaper Than AWS S3 + CloudFront

```
At 500 users (165 GB screenshots, 1 TB CDN egress):
  AWS S3 storage:         165 GB × $0.023 = $3.80/month
  AWS CloudFront egress:  1,000 GB × $0.085 = $85.00/month
  Total AWS file cost:    $88.80/month

  B2 storage:             155 GB × $0.006 = $0.93/month
  Cloudflare egress:      $0 (Bandwidth Alliance)
  Total our file cost:    $0.93/month

  Saving: $87.87/month (99% cheaper)
```

#### Lever 3 — Self-Hosted PostgreSQL + Valkey = $0 Instead of $155/month

```
  AWS RDS PostgreSQL db.t3.medium Multi-AZ: $105.12/month
  AWS ElastiCache Redis cache.t3.medium:     $49.64/month
  Total AWS managed DB:                     $154.76/month

  Self-hosted PostgreSQL on Oracle:          $0
  Self-hosted Valkey on Oracle:              $0
  Total our DB:                              $0

  Saving: $154.76/month
  Trade-off accepted: we manage backups ourselves (automated, backed up to B2)
```

#### Lever 4 — Presigned URLs = API Server Never Handles File Bandwidth

```
Without presigned URLs:
  Agent uploads 80 KB screenshot → API server → API server → B2
  API server handles all file bandwidth → needs bigger compute

With presigned URLs:
  Agent requests upload URL from API (tiny JSON response, ~200 bytes)
  Agent uploads 80 KB directly to B2 — API server receives nothing
  API server only handles metadata confirmation (tiny JSON)

Benefit: API server bandwidth = ~5 MB/user/day (JSON only)
         Instead of:          ~14 MB/user/day (JSON + raw screenshots)
Compute saving:               ~65% less bandwidth on API server
```

#### Lever 5 — Brevo Free Tier = $0 Email Until 600 Users

```
  Brevo free tier: 9,000 emails/month, 300/day — forever
  At 500 users × 15 emails/month = 7,500 emails → fully covered by free tier
  Cost: $0

  AWS SES: $0.10/1,000 = $0.75/month (almost free but still non-zero)
  SendGrid Essentials: $14.95/month minimum
  Mailgun: $35/month minimum

  Saving vs SendGrid: $14.95/month × 12 = $179.40/year
```

---

### Revenue vs Infrastructure — Real Profitability

| Users | Monthly Revenue | Stripe Fees | Infrastructure | Net Margin | Margin % |
|---|---|---|---|---|---|
| 100 | ~$600 | ~$57 | $0.14 | **$542** | **90.4%** |
| 500 | ~$3,000 | ~$287 | $0.93 | **$2,712** | **90.4%** |
| 1,000 | ~$6,000 | ~$574 | $31 | **$5,395** | **89.9%** |
| 2,000 | ~$12,000 | ~$1,148 | $44 | **$10,808** | **90.1%** |
| 5,000 | ~$30,000 | ~$2,870 | $81 | **$27,049** | **90.2%** |

**The dominant cost is Stripe payment processing, not infrastructure. Infrastructure is essentially negligible.**

---

### Free Tier Break Points (When Each Service Starts Costing Money)

| Free Tier | Breaks At | Cost After | Monthly Bill |
|---|---|---|---|
| B2 first 10 GB free | ~30 users after month 1 | $0.006/GB/month | $0.93 at 500 users |
| Brevo 300 emails/day (9,000/month) | ~600 users | Starter $9/month (5K) or $29/month (20K) | $9–$69/month |
| Oracle 10 TB egress | ~51,500 streaming users | $25/TB overage | Far beyond MVP roadmap |
| Oracle 200 GB block storage | ~4,000 users (without retention policy) | $0.0255/GB/month extra | $12.75/month for 500 GB |
| Oracle A1 compute capacity | ~2,000–5,000 concurrent users at peak | Add Hetzner CX22 | ~€4.49/month (~$4.90) |
| Upstash Redis free (if used) | ~200 active users | $0.20/100K commands | ~$20–50/month at scale |

---

## 8. Data Growth & Storage Scaling Strategy

### How Much Data Does 1 User Generate Per Month?

#### PostgreSQL (Structured Data on Oracle VM2)

| Table | Events/User/Month | Avg Row Size | MB/User/Month |
|---|---|---|---|
| `activity_events` | 500/day × 22 days = 11,000 | ~500 bytes | ~5.5 MB |
| `gps_locations` | 480/day × 22 days = 10,560 | ~100 bytes | ~1.0 MB |
| `keystroke_intensity` | 480/day × 22 days = 10,560 | ~100 bytes | ~1.0 MB |
| `screenshots` metadata | 96/day × 22 days = 2,112 | ~200 bytes | ~0.4 MB |
| `app_usage_summary` | 50 apps × 22 days = 1,100 | ~300 bytes | ~0.3 MB |
| `productivity_scores` | 8 hr × 22 days = 176 | ~200 bytes | ~0.03 MB |
| `time_entries` | ~22 records | ~300 bytes | ~0.006 MB |
| `gps_routes` | ~22 records | ~2 KB JSONB | ~0.04 MB |
| **Total PostgreSQL** | | | **~8–10 MB/user/month** |

#### Backblaze B2 (File Storage — Already Scales Cheaply)

| File Type | Per User Per Month |
|---|---|
| Screenshots (JPEG ~80 KB each) | 2,112 × 80 KB = **~165 MB** |
| Thumbnails (~5 KB each) | 2,112 × 5 KB = **~10 MB** |
| **Total B2** | **~175 MB/user/month** |

---

### When Does Oracle's 200 GB Block Storage Fill Up?

**Oracle block storage breakdown:**
```
VM1 boot volume:           50 GB
VM2 boot volume:           50 GB
VM2 PostgreSQL data:      100 GB available
─────────────────────────────────
Usable for PostgreSQL:    ~100 GB
```

**Without retention policy (data grows forever):**

| Users | Growth Rate | Fills 100 GB In |
|---|---|---|
| 100 | ~1 GB/month | 100 months |
| 500 | ~5 GB/month | 20 months |
| 1,000 | ~10 GB/month | **10 months — WARNING** |
| 2,000 | ~20 GB/month | **5 months — DANGER** |
| 5,000 | ~50 GB/month | **2 months — CRITICAL** |

**With 90-day retention policy (raw events deleted, aggregates kept forever):**

| Users | PostgreSQL Size (Stable, Never Grows) | Oracle 100 GB Limit |
|---|---|---|
| 100 | ~2.4 GB | 2.4% used |
| 500 | ~12 GB | 12% used |
| 1,000 | ~24 GB | 24% used |
| 3,000 | ~72 GB | 72% used |
| 4,000 | ~96 GB | **96% — time to upgrade storage** |

**The retention policy changes the problem from "fills in months" to "stable forever".**

---

### 3-Layer Data Lifecycle Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  HOT LAYER (0–90 days)         PostgreSQL on Oracle VM2             │
│  Full granularity              activity_events, gps_locations,       │
│  Live queries possible         keystroke_intensity, screenshots      │
│  8–10 MB/user/month           Cost: $0 (Oracle free)                │
└─────────────────────────────────────────────────────────────────────┘
         ↓ after 90 days, aggregate and delete raw rows
┌─────────────────────────────────────────────────────────────────────┐
│  WARM LAYER (forever)          PostgreSQL on Oracle VM2             │
│  Monthly aggregates only       app_usage_monthly, time_entries,      │
│  No raw event detail           attendance, productivity_scores        │
│  ~0.1 MB/user/month           Cost: $0 (Oracle free)                │
└─────────────────────────────────────────────────────────────────────┘
         ↓ premium plan only: archive before deleting
┌─────────────────────────────────────────────────────────────────────┐
│  COLD LAYER (1yr+)             Backblaze B2 Object Storage          │
│  Compressed NDJSON archives    activity_events_2025-10.ndjson.gz    │
│  Restore for audit on demand   ~0.5 MB/user/month compressed        │
│  Cost: $0.006/GB              1,000 users × 12 months = $0.036/mo  │
└─────────────────────────────────────────────────────────────────────┘
```

---

### What Gets Kept Forever vs What Gets Deleted

| Data | Retention | Why |
|---|---|---|
| `time_entries` | **Forever** | Payroll, legal, client billing records |
| `attendance` | **Forever** | Legal compliance, HR records |
| `timesheets` | **Forever** | Payroll, compliance |
| `productivity_scores` (aggregated) | **Forever** | Pre-computed, tiny size |
| `app_usage_monthly` (aggregated) | **Forever** | Pre-computed, tiny size |
| `app_usage_summary` (daily) | **1 year** | Detailed enough, manageable size |
| `activity_events` (raw) | **90 days** | Large table, aggregates replace it |
| `gps_locations` (raw) | **90 days** | Large table, routes table replaces it |
| `keystroke_intensity` (raw) | **90 days** | Included in productivity_scores |
| `screenshots` metadata | **90 days** | Matched by B2 file purge |
| B2 screenshot files | **90 days** | Storage cost driver |
| `gps_routes` (JSONB) | **1 year** | Valuable for disputes, manageable size |

---

### PostgreSQL Partitioning Strategy

Partitioning large time-series tables so old data can be dropped instantly:

```sql
-- Partition activity_events by month
CREATE TABLE activity_events (
    id UUID DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL,
    org_id UUID NOT NULL,
    app_name TEXT,
    window_title TEXT,
    url TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ
) PARTITION BY RANGE (started_at);

-- pg_partman auto-creates this every month
CREATE TABLE activity_events_2026_01
  PARTITION OF activity_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- 90 days later, dropping the partition is INSTANT
-- No table lock, no slow DELETE scan, disk space freed immediately
DROP TABLE activity_events_2025_10;

-- Same pattern for:
-- gps_locations (partitioned by recorded_at)
-- keystroke_intensity (partitioned by recorded_at)
-- screenshots (partitioned by captured_at)
```

**pg_partman** extension automates: create next month's partition, drop partitions older than retention threshold. Zero manual intervention.

---

### Nightly Aggregation + Purge Job (pg_cron)

```sql
-- Step 1: Aggregate activity_events older than 90 days into monthly summary
INSERT INTO app_usage_monthly (employee_id, org_id, month, app_name, category, total_mins)
SELECT
    employee_id, org_id,
    date_trunc('month', started_at) AS month,
    app_name, category,
    SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) AS total_mins
FROM activity_events
WHERE started_at < NOW() - INTERVAL '90 days'
ON CONFLICT (employee_id, org_id, month, app_name)
DO UPDATE SET total_mins = app_usage_monthly.total_mins + EXCLUDED.total_mins;

-- Step 2: Drop old partition (instant, no lock)
-- Handled automatically by pg_partman scheduled job

-- Step 3: Enqueue B2 cleanup for deleted screenshot records
INSERT INTO b2_cleanup_queue (b2_key, thumbnail_key)
SELECT b2_key, thumbnail_key FROM screenshots
WHERE captured_at < NOW() - INTERVAL '90 days';

-- Step 4: B2 cleanup worker processes the queue and calls B2 delete API
-- (separate async worker, not in cron job)
```

---

### B2 Screenshot Purge

```
B2 Lifecycle Rule configured per bucket:
  Rule: delete objects in prefix "screenshots/" older than 90 days
  This is a native B2 feature — zero code needed
  Runs server-side on Backblaze's infrastructure

Alternative (for more control):
  Background worker reads b2_cleanup_queue table
  Calls B2 delete API for each key
  Marks record as purged in PostgreSQL
  Cost of B2 delete API: $0 (Class A — always free)
```

---

### When to Upgrade Storage — Decision Points

#### Decision Point 1: PostgreSQL Approaching 80 GB (at ~3,000–4,000 users)

**Option A: Add Oracle Paid Block Storage (Cheapest)**
```
Oracle block storage: $0.0255/GB/month
Add 500 GB extra volume: 500 × $0.0255 = $12.75/month
New total: 100 GB free + 500 GB paid = 600 GB
Supports: up to ~25,000 users with retention policy
```

**Option B: Migrate PostgreSQL to Hetzner Volume Server**
```
Hetzner AX42 dedicated server:
  AMD EPYC, 12 cores, 64 GB RAM, 2 × 512 GB NVMe
  Price: ~€79/month (~$86/month)
  Trigger: when you exceed 5,000 users (~$30,000 MRR)
  $86 on $30,000 revenue = 0.3% infrastructure ratio
  PostgreSQL performance: handles 50,000+ users easily
```

**Option C: Supabase Managed PostgreSQL (Zero Ops)**
```
Supabase Pro: $25/month — 8 GB RAM, 250 GB storage, PITR backups
Supabase Team: $599/month — 16 GB RAM, 500 GB storage
Advantages: fully managed, dashboard, automatic backups, read replicas
Trigger: when ops time is more expensive than $25–$599/month
```

#### Decision Point 2: B2 Storage Costs Growing (Screenshots)

```
B2 cost at 1,000 users with no purge:
  1,000 users × 175 MB/month × 12 months = 2.1 TB
  2.1 TB × $0.006/GB = $12.60/month

B2 cost at 1,000 users with 90-day purge:
  1,000 users × 175 MB × 3 months = 525 GB
  525 GB × $0.006/GB = $3.15/month (stays stable forever)

Screenshot purge is mandatory from day one.
```

---

## 9. Full Scaling Roadmap

### Phase 1: 0 → 500 Users ($0–$0.93/month infra)

```
Infrastructure:
  Oracle VM1 + VM2 free tier (2 × 2 OCPU / 12 GB ARM)
  Backblaze B2 + Cloudflare CDN
  Brevo free email (under 9,000/month)

Database state:
  PostgreSQL: ~12 GB (90-day retention)
  Oracle 200 GB: 12% used

Actions:
  ✓ Enable pg_partman for activity_events, gps_locations, keystroke_intensity, screenshots
  ✓ Configure B2 lifecycle rule (90-day auto-delete)
  ✓ Enable pg_cron for nightly aggregation job
  ✓ Monitor Oracle block storage in Grafana (free tier)
```

### Phase 2: 500 → 2,000 Users (~$30–$44/month infra)

```
Infrastructure:
  Same Oracle free tier (still sufficient)
  Brevo Starter $9–$29/month (past 600 users)

Database state:
  PostgreSQL: ~12–48 GB (90-day retention, stable)
  Oracle 200 GB: 12–24% used

Actions:
  ✓ Add read replica on Oracle (second A1 instance if provisioning allows)
  ✓ Enable pg_stat_statements for slow query detection
  ✓ Consider moving analytics queries to pre-aggregated tables only
  ✓ Set up daily pg_dump backup to B2 (~1 GB compressed, $0.006/month)
```

### Phase 3: 2,000 → 5,000 Users (~$50–$100/month infra)

```
Infrastructure:
  Oracle free tier (compute still sufficient)
  + Oracle paid block storage: +500 GB at $12.75/month
  B2 storage: ~$5–$10/month
  Brevo Starter: $29–$69/month

Database state:
  PostgreSQL: ~48–120 GB (retention policy keeps it bounded)
  Oracle 200 GB free + 500 GB paid = 700 GB: 17–24% used

Actions:
  ✓ Add Oracle paid block storage 500 GB (~$12.75/month)
  ✓ Enable TimescaleDB extension for time-series query optimization
  ✓ Set up Grafana Cloud (free tier) monitoring for DB query performance
  ✓ Enable PgBouncer transaction mode (from session mode) for higher throughput
```

### Phase 4: 5,000 → 20,000 Users (~$100–$250/month infra)

```
Infrastructure:
  Oracle VM1 + VM2 (keep NestJS + Next.js — still free)
  + Hetzner AX42 dedicated ($86/month) → PostgreSQL migrated here
    (AMD EPYC, 12 cores, 64 GB RAM, 2 × 512 TB NVMe)
  B2 storage: ~$10–$40/month
  Brevo Business: $69/month

Database state:
  PostgreSQL on Hetzner: 120–480 GB (comfortably handled)
  Valkey still on Oracle VM2 (add Hetzner if needed)

Actions:
  ✓ Migrate PostgreSQL to Hetzner AX42
  ✓ Keep Oracle VMs for NestJS + Next.js + Valkey (still free!)
  ✓ Add streaming replication from Hetzner primary to Oracle VM2 read replica
  ✓ Analytics queries routed to read replica, writes to primary
  ✓ Consider Cloudflare R2 as overflow storage alongside B2
```

### Phase 5: 20,000+ Users (~$500+/month infra, millions in revenue)

```
Infrastructure:
  Multiple NestJS workers on multiple Oracle VMs or Hetzner VPS fleet
  PostgreSQL with TimescaleDB on dedicated Hetzner hardware
  Redis Cluster for Valkey (multi-node)
  AWS Aurora Serverless as option for true auto-scaling PostgreSQL
  B2 + Cloudflare R2 for storage (dual storage strategy)

Revenue at this stage: ~$120,000+/month
Infrastructure as % of revenue: < 0.5%
```

---

## Appendix: Key Numbers Reference

### Per-User Monthly Data Fingerprint

| Layer | Data Generated | Storage Used | Cost |
|---|---|---|---|
| PostgreSQL (raw, 90 days) | 11,000+ events | ~24 MB stable | $0 (Oracle free) |
| PostgreSQL (aggregates, forever) | ~50 records/month | ~0.1 MB/month | $0 (Oracle free) |
| Backblaze B2 (90-day window) | 2,112 screenshots | ~175 MB stable | ~$0.001/user/month |
| Valkey (hot cache) | Transient | ~100 KB | $0 (self-hosted) |
| SQLite (agent, temporary) | Sync buffer | < 10 MB peak | $0 (on employee PC) |

### Service Pricing Quick Reference (Verified 2026-04-03)

| Service | Free Tier | Paid Tier |
|---|---|---|
| Oracle A1 Compute | 4 OCPU + 24 GB RAM, forever | $0.01/OCPU-hr beyond |
| Oracle Block Storage | 200 GB, forever | $0.0255/GB/month |
| Oracle Egress | 10 TB/month, forever | $25/TB overage |
| Backblaze B2 Storage | First 10 GB | $0.006/GB/month |
| B2 Egress via Cloudflare | Unlimited (Bandwidth Alliance) | $0 forever |
| B2 Class A API (uploads) | Always free | $0 forever |
| Cloudflare CDN | Unlimited bandwidth | $0 forever |
| Cloudflare R2 Storage | 10 GB + 1M writes + 10M reads | $0.015/GB/month |
| Brevo Email | 9,000/month (300/day) | $9/month (5K), $29/month (20K) |
| Stripe | No monthly fee | 2.9% + $0.30/txn (US), ~2% (India domestic) |
| Upstash Redis | 256 MB + 500K cmds/month | $0.20/100K commands |
| Hetzner CX22 | No free tier | €4.49/month (~$4.90) |
| AWS RDS db.t3.medium | No free tier | $0.072/hr (~$52.56/month) Single-AZ |
| AWS ElastiCache t3.medium | No free tier | $0.068/hr (~$49.64/month) |
| AWS ECS Fargate (1 vCPU, 2 GB) | No free tier | ~$35.55/month (24/7) |

---

*Document version: 1.0 — 2026-04-03*  
*Next review: when user count crosses 500*
