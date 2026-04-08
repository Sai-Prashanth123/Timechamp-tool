# Time Champ Clone — System Development Design
**Date:** 2026-04-08
**Status:** Approved
**Approach:** Critical Path First (Approach C)
**Scope:** Web + Desktop Agent (no mobile v1)
**Stack:** AWS (S3, SES, Redis) — OCI migration post-launch
**Team:** Solo developer + Claude Code

---

## 1. Overview

Full workforce intelligence SaaS platform built as a Time Champ clone. Production-ready build locally, then single deployment push. 12 sub-projects total — Phase 1 (5 critical path sub-projects) ships a complete sellable product.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | NestJS + Fastify, PM2 cluster |
| Web Dashboard | Next.js 14, App Router, NextAuth.js |
| Desktop Agent | Go, cross-platform binary |
| Database | PostgreSQL + TypeORM + RLS |
| Cache / Sessions | Redis (AWS ElastiCache) |
| File Storage | AWS S3 (screenshots, agent binaries) |
| Email | AWS SES |
| Payments | Stripe |
| Error Tracking | Sentry |

---

## 3. Build Strategy

### Phase 1 — Critical Path (5 sub-projects)

These 5 sub-projects together deliver a complete, sellable product:

```
Customer signs up → picks plan → pays via Stripe
  → Invites team → team accepts via email
  → Installs desktop agent → agent syncs data
  → Manager watches live dashboard
  → Employees clock in/out
  → Manager approves timesheets
  → Admin exports payroll CSV
```

| # | Sub-Project | Depends On |
|---|------------|-----------|
| SP1 | Foundation (email flows, org settings, user management) | — |
| SP2 | Agent → API Sync Pipeline | SP1 |
| SP3 | Monitoring Dashboard | SP2 |
| SP4 | Time Tracking | SP2 |
| SP5 | Billing (Stripe) | SP1 |

### Phase 2 — After First Customer

| # | Sub-Project |
|---|------------|
| SP6 | GPS & Geofencing |
| SP7 | Projects & Tasks (Kanban) |
| SP8 | Analytics & Reports |
| SP9 | Alerts |
| SP10 | Integrations (Slack, Jira, Webhooks) |
| SP11 | Live Streaming |
| SP12 | Mobile App (React Native) |

---

## 4. What Is Already Built

Do not rewrite these — they are complete and production-quality:

| Component | Location | Status |
|-----------|----------|--------|
| Auth API (register, login, logout, refresh, token rotation) | `apps/api/src/modules/auth/` | Complete |
| DB migrations 001–010 | `apps/api/src/database/migrations/` | Complete |
| All NestJS module skeletons | `apps/api/src/modules/*/` | Scaffolded |
| All TypeORM entities | `apps/api/src/database/entities/` | Complete |
| Web login + register forms | `apps/web/components/auth/` | Complete |
| Web dashboard shell + layout | `apps/web/app/(dashboard)/` | Complete |
| Agent capture (screenshots, activity, idle, input) | `apps/agent/internal/capture/` | Complete |
| Agent SQLite buffer | `apps/agent/internal/buffer/` | Complete |
| Agent S3 uploader | `apps/agent/internal/sync/s3.go` | Complete |
| Agent watchdog | `apps/agent/cmd/watchdog/` | Complete |

---

## 5. System Architecture

### Data Flow

```
Employee's Computer
  └── Go Agent
        ├── Captures screenshot → S3 presigned URL → S3 bucket
        ├── Captures activity events → POST /agent/sync/activity
        ├── Captures GPS → POST /agent/sync/gps
        └── Heartbeat → POST /agent/sync/heartbeat

NestJS API (VM1)
  ├── Writes metadata to PostgreSQL (VM2)
  ├── Publishes events to Redis pub/sub
  └── Emits via Socket.IO to connected managers

Manager's Browser
  ├── Next.js dashboard receives WebSocket events
  ├── Shows employee online/idle/offline status in real time
  └── Loads screenshots from S3 via signed URLs
```

### Multi-Tenancy

- Every table has `organization_id`
- PostgreSQL RLS policies enforce tenant isolation at DB level
- Tenant middleware sets `SET LOCAL app.current_org` per request
- JWT carries `orgId` — verified on every request
- Even buggy query logic cannot leak cross-tenant data

---

## 6. SP1 — Foundation

### What to Build

#### Backend — 3 Email Flows

**1. Email Verification**
- On register: generate signed token → store in Redis (TTL 24h) → send via SES
- `GET /auth/verify-email?token=xxx` → mark `email_verified = true`
- `POST /auth/resend-verification` → regenerate + resend
- Unverified users can log in but see banner, cannot invite team members

**2. User Invite Flow**
- `POST /users/invite` creates user — add: generate invite token → store in Redis (TTL 72h) → send invite email
- `POST /auth/accept-invite` → validates token → sets firstName, lastName, password → marks email_verified = true
- Invite link format: `https://app.timechamp.com/accept-invite?token=xxx`

**3. Password Reset**
- `POST /auth/forgot-password` → generate reset token → Redis (TTL 1h) → send email
- `POST /auth/reset-password` → validate token → hash new password → invalidate all refresh tokens

#### Frontend — 4 New Pages

| Page | Route |
|------|-------|
| Accept invite | `/accept-invite` |
| Forgot password | `/forgot-password` |
| Reset password | `/reset-password` |
| Email verification banner | Dashboard layout (persistent until verified) |

#### Existing Pages to Wire Up

**Organization settings** (`/settings/organization`):
- Update org name, timezone, logo (S3 upload)
- Screenshot interval config (5/10/15/30 min → stored in agent_config table)
- Working hours config

**User management** (`/settings/users`):
- Table: name, email, role, status, last active
- Invite modal → sends email
- Deactivate user with confirmation
- Role change (Admin / Manager / Employee)

#### Email Templates (AWS SES)

| Email | Subject | Expiry |
|-------|---------|--------|
| Verify email | "Please verify your email — TimeChamp" | 24h |
| Team invite | "{Admin} invited you to {Org} on TimeChamp" | 72h |
| Password reset | "Reset your TimeChamp password" | 1h |

All emails: HTML + plain text versions.

### Tests

| Test | Type |
|------|------|
| Register → verify email → login | E2E |
| Invite flow end-to-end | E2E |
| Password reset flow | E2E |
| Expired token rejected | Unit |
| Duplicate email handling | Unit |

---

## 7. SP2 — Agent → API Sync Pipeline

### Agent Side

#### `cmd/agent/main.go` — Orchestrator

```
Start
  ├── Load config from keychain (org token, API URL, intervals)
  ├── Register device with API → receive device_id
  ├── Start goroutines:
  │     ├── CaptureLoop    → screenshot every N min → S3 → metadata to SQLite
  │     ├── ActivityLoop   → app/window title every 10s → SQLite
  │     ├── IdleLoop       → idle detection → SQLite event
  │     ├── InputLoop      → keystroke/mouse count per min → SQLite
  │     └── SyncLoop       → every 30s → flush SQLite → POST to API
  └── Block on OS signal (SIGTERM/SIGINT → graceful shutdown)
```

#### Screenshot Pipeline

```
Capture screen (OS API)
  → Compress JPEG (quality 85, max 1920px wide)
  → GET /agent/upload-url → presigned S3 URL
  → PUT directly to S3 (never through API)
  → Store metadata in SQLite: {s3_key, timestamp, active_app, active_window}
  → SyncLoop picks up → POST /agent/sync/screenshots
```

#### Sync Loop (30s interval)

```
Read up to 100 unsynced events from SQLite
  → POST /agent/sync/activity   (batch)
  → POST /agent/sync/screenshots (metadata batch)
  → POST /agent/sync/gps        (batch, field workers only)
  → POST /agent/heartbeat       (always)
  → Mark synced in SQLite
  → On 5xx: exponential backoff (30s → 1m → 5m → 15m → 1h)
  → On 401: re-register device
```

### API Side

#### Agent Authentication

- Device authenticates via `X-Device-Token` header (not JWT)
- Token stored in `agent_devices` table with `organization_id` and `user_id`
- `AgentAuthGuard` validates token, attaches device context to request

#### New DB Migration — `agent_devices` Table

```sql
CREATE TABLE agent_devices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token    VARCHAR(255) UNIQUE NOT NULL,
  hostname        VARCHAR(255),
  platform        VARCHAR(50),       -- 'windows' | 'darwin' | 'linux'
  agent_version   VARCHAR(50),
  last_seen_at    TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_devices_token ON agent_devices(device_token);
CREATE INDEX idx_agent_devices_user  ON agent_devices(user_id);
```

#### API Endpoints

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/agent/register` | POST | Register device, return device_token |
| `/agent/heartbeat` | POST | Update last_seen_at, emit Socket.IO status |
| `/agent/upload-url` | GET | Return presigned S3 URL for screenshot |
| `/agent/sync/activity` | POST | Batch insert activity events |
| `/agent/sync/screenshots` | POST | Batch insert screenshot metadata |
| `/agent/sync/gps` | POST | Batch insert GPS locations |
| `/agent/config` | GET | Return org config (interval, blur apps) |

#### Redis Pub/Sub After Each Sync

```
API receives heartbeat/activity
  → Publish to Redis: org:{orgId}:employee:{userId}
  → Socket.IO gateway picks up → emit to manager browser
  → Manager sees live status update instantly
```

### Tests

| Test | Type |
|------|------|
| Agent register → valid device_token returned | Unit |
| Heartbeat updates last_seen_at | Unit |
| Activity batch insert (100 events) | Unit |
| Screenshot presigned URL generation | Unit |
| Invalid device token rejected 401 | Unit |
| Offline buffer → retry on reconnect | Integration |

---

## 8. SP3 — Monitoring Dashboard

### Pages

| Route | Page | Access |
|-------|------|--------|
| `/overview` | Live employee grid | Admin, Manager |
| `/monitoring/[userId]` | Employee deep-dive | Admin, Manager |
| `/monitoring/screenshots` | Screenshot gallery | Admin, Manager |

### `/overview` — Live Employee Grid

- Card per employee: avatar, name, status badge, active app, last screenshot thumbnail, today's hours
- Status updates via Socket.IO — no polling, no refresh
- Filters: All / Online / Idle / Offline, name search
- Click card → `/monitoring/[userId]`

**Real-time flow:**
```
Manager loads /overview
  → Browser connects Socket.IO (JWT auth)
  → Joins room: org:{orgId}
  → Server emits employee:{userId}:status on each agent heartbeat
  → React updates card via Zustand store
```

### `/monitoring/[userId]` — Employee Deep-Dive

**Tabs:**
1. **Live** — Current screenshot (auto-refreshes), active app + window title, today's activity
2. **Screenshots** — Paginated grid for selected date. Click to enlarge. Timestamp + active app shown
3. **Activity** — Bar chart: app time per hour. Table: app name, duration, % of day
4. **Timeline** — Horizontal view: work blocks, idle periods, clock events for selected date

### `/monitoring/screenshots` — Screenshot Gallery

- All employees, all screenshots for selected date
- 4-column grid, lazy loaded
- Filter by employee, time range
- S3 signed URLs (API generates, cached 1h)
- Blur toggle per session

### API Endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /monitoring/employees` | All employees: status, last_seen, today's hours |
| `GET /monitoring/employees/:id/status` | Single employee live status |
| `GET /monitoring/employees/:id/screenshots` | Paginated screenshots, date filter |
| `GET /monitoring/employees/:id/activity` | Activity events, date filter |
| `GET /monitoring/employees/:id/timeline` | Work/idle blocks for date |
| `GET /monitoring/screenshots` | All org screenshots, paginated |
| `GET /monitoring/screenshots/:id/url` | Fresh S3 signed URL |

### Socket.IO Events

| Event (server → client) | Payload |
|------------------------|---------|
| `employee:status` | `{ userId, status, activeApp, lastSeen }` |
| `employee:screenshot` | `{ userId, screenshotId, thumbnailUrl, timestamp }` |
| `employee:activity` | `{ userId, appName, windowTitle, timestamp }` |

### Frontend State (Zustand)

```typescript
monitoringStore {
  employees: Map<userId, EmployeeStatus>
  screenshots: Map<userId, Screenshot[]>
  socket: Socket

  actions: connectSocket(), handleEmployeeStatus(), handleScreenshot(), fetchEmployees()
}
```

### Tests

| Test | Type |
|------|------|
| `GET /monitoring/employees` returns only org's employees | Unit |
| Screenshot URL signed correctly, expires 1h | Unit |
| Socket.IO emits on heartbeat | Integration |
| Cross-tenant data leak prevention | Unit |

---

## 9. SP4 — Time Tracking

### Pages

| Route | Page | Access |
|-------|------|--------|
| `/time-tracking` | My timesheet | Employee |
| `/time-tracking/team` | Team timesheets | Admin, Manager |
| `/time-tracking/approvals` | Approval queue | Admin, Manager |
| `/time-tracking/reports` | Payroll export | Admin |

### Clock State Machine

```
CLOCKED_OUT → [Clock In] → CLOCKED_IN
CLOCKED_IN  → [Idle 15min] → ON_BREAK (auto)
ON_BREAK    → [Activity] → CLOCKED_IN (auto resume)
CLOCKED_IN  → [Clock Out] → CLOCKED_OUT
```

**3 clock-in methods:** manual (button), auto (agent detects first activity), schedule (v2)

### Time Entry Data Model

```sql
time_entries:
  id, organization_id, user_id
  clock_in_at, clock_out_at
  total_minutes          -- computed on clock-out
  clock_in_method        -- 'manual' | 'auto' | 'agent'
  notes                  -- optional employee note
  status                 -- 'active' | 'pending' | 'approved' | 'rejected'
  approved_by, approved_at, rejection_reason
  created_at, updated_at
```

Constraint: only 1 active entry per user (partial unique index on `user_id WHERE status = 'active'`).

### Page Specs

**`/time-tracking` (Employee):**
- Today: clock-in time, running timer, Clock Out button
- This week: daily breakdown table (date, in, out, hours, status)
- Manual entry button → form (date, in, out, note) → pending approval

**`/time-tracking/team` (Manager):**
- Table: employee, Mon–Sun hours, week total, status
- Click row → employee's daily breakdown
- Bulk approve week button
- Export CSV

**`/time-tracking/approvals` (Manager):**
- Pending entries needing review
- Shows: employee, date, hours, method, note
- Approve / Reject (with reason) per row
- Bulk approve all

**`/time-tracking/reports` (Admin):**
- Date range picker (pay period)
- Per employee: total hours, overtime hours (>8h/day), approved only
- Export: CSV, PDF

### API Endpoints

| Endpoint | What It Does |
|----------|-------------|
| `POST /time-tracking/clock-in` | Start entry, return entry |
| `POST /time-tracking/clock-out` | Close entry, compute minutes |
| `GET /time-tracking/my` | Employee's entries, date range |
| `GET /time-tracking/active` | Currently active entry |
| `POST /time-tracking/manual` | Add manual entry → pending |
| `GET /time-tracking/team` | All team entries, date range |
| `POST /time-tracking/approve/:id` | Approve entry |
| `POST /time-tracking/reject/:id` | Reject with reason |
| `GET /time-tracking/report` | Payroll summary |
| `GET /time-tracking/export` | CSV download |

### Business Rules

- Only 1 active entry per user at a time (enforced at DB level)
- Overtime = hours > 8/day (configurable per org)
- Manual entries always require approval
- Auto entries require approval only if `org.require_timesheet_approval = true`
- Rejected entries can be re-submitted with updated notes
- Manager cannot approve their own entries

### Tests

| Test | Type |
|------|------|
| Cannot clock in twice (active entry exists) | Unit |
| Clock out computes total_minutes correctly | Unit |
| Manual entry status = pending | Unit |
| Manager cannot approve own entries | Unit |
| Payroll export includes approved entries only | Unit |
| Cross-tenant isolation on team view | Unit |

---

## 10. SP5 — Billing (Stripe)

### Plans

| Plan | Price | Max Seats | Features |
|------|-------|-----------|---------|
| Starter | $9/user/mo | 10 | Monitoring, time tracking |
| Pro | $15/user/mo | 100 | + GPS, projects, analytics, alerts |
| Enterprise | $25/user/mo | Unlimited | + Integrations, streaming, priority support |

### Pages

| Route | Page | Access |
|-------|------|--------|
| `/settings/billing` | Plan, usage, invoices | Admin |
| `/onboarding/plan` | Plan picker after registration | Admin (new orgs) |

### New Customer Flow

```
Register → /onboarding/plan
  → Pick plan → POST /billing/checkout → Stripe Checkout Session
  → Redirect to Stripe hosted checkout
  → Payment succeeds → Stripe webhook → our API
  → Webhook: activate subscription in DB
  → Customer redirected to /overview
```

### 14-Day Free Trial

- All new orgs: `status: trialing`, no card required
- 3 days before expiry: `customer.subscription.trial_will_end` webhook → warning email
- Expiry: `status: past_due` → dashboard banner, features soft-locked
- Org has 7-day grace period before hard lock

### `/settings/billing` Page

- Current plan, price per seat
- Seats used / seats total (e.g., "7 / 10 seats")
- Next billing date + amount
- "Upgrade Plan" → Stripe Customer Portal
- "Manage Payment Method" → Stripe Customer Portal
- Invoice history table (from Stripe API)
- Cancel subscription (with confirmation dialog)

### Stripe Webhooks

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Activate subscription, store stripe_subscription_id |
| `customer.subscription.updated` | Update plan, seats, status |
| `customer.subscription.deleted` | Set status canceled, begin grace period |
| `customer.subscription.trial_will_end` | Send 3-day warning email |
| `invoice.payment_succeeded` | Store current_period_end, send receipt email |
| `invoice.payment_failed` | Set status past_due, send dunning email |

All webhooks: Stripe signature verification (`stripe.webhooks.constructEvent`). Idempotent handlers (safe to replay).

### API Endpoints

| Endpoint | What It Does |
|----------|-------------|
| `POST /billing/checkout` | Create Stripe Checkout Session, return URL |
| `POST /billing/portal` | Create Stripe Customer Portal session, return URL |
| `GET /billing/subscription` | Current plan, status, seats, next billing |
| `GET /billing/invoices` | List invoices from Stripe |
| `POST /billing/webhook` | Stripe webhook handler (no JWT, signature verified) |

### Seat Limit Enforcement

- `UsersService.invite()` checks active user count vs subscription seats before creating
- At limit → `ForbiddenException('Seat limit reached. Upgrade your plan.')`
- Seat count synced from Stripe on every `subscription.updated` webhook

### Feature Gating

```typescript
const PLAN_FEATURES = {
  starter:    ['monitoring', 'time_tracking'],
  pro:        ['monitoring', 'time_tracking', 'gps', 'projects', 'analytics', 'alerts'],
  enterprise: ['*'],
};

// Usage: @RequiresPlan('pro') on controller routes
// Returns 403 + { upgradeUrl: '/settings/billing' } if plan insufficient
```

### Tests

| Test | Type |
|------|------|
| Checkout session created with correct Stripe price ID | Unit |
| Webhook signature rejection on tampered payload | Unit |
| subscription.deleted locks org correctly | Unit |
| Seat limit blocks invite at cap | Unit |
| past_due org blocked from protected routes | Unit |
| Trial expiry flow end-to-end | Integration |

---

## 11. Phase 2 Sub-Projects (After First Customer)

### SP6 — GPS & Geofencing
- Field staff real-time location on map
- Geo-fenced attendance: auto clock-in when enter site, clock-out when leave
- Location history playback (breadcrumb trail per day)
- Geofence CRUD (polygon or radius)

### SP7 — Projects & Tasks
- Kanban board (To Do / In Progress / Done)
- Task assignment to users
- Milestones with due dates
- Time logged per task (links to time tracking)

### SP8 — Analytics & Reports
- Productivity score per employee (active time / total work time)
- App usage breakdown (productive / neutral / unproductive categories)
- Team productivity trends (week/month)
- Export: PDF reports, CSV data dumps

### SP9 — Alerts
- Rule-based alert engine: idle > X min, late clock-in, no clock-out, unusual hours
- Alert channels: in-app, email, Slack
- Alert history and acknowledgement

### SP10 — Integrations
- Slack: alert notifications, daily summary posts
- Jira: sync tasks, time logged
- Webhooks: POST to external URL on events
- API keys: external access for custom integrations

### SP11 — Live Streaming
- On-demand screen capture stream (manager triggers)
- Camera feed (if employee consents)
- Audio (if org setting enabled)
- Already scaffolded in `apps/agent/internal/stream/` and `apps/api/src/modules/streaming/`

### SP12 — Mobile App (Post-v1)
- React Native (Expo bare workflow)
- GPS tracking for field staff
- Clock in/out with geofence auto-trigger
- Push notifications (Firebase FCM)
- View own timesheet and task assignments

---

## 12. Quality Standards (All Sub-Projects)

- All API routes have input validation (class-validator DTOs)
- All errors return consistent `{ statusCode, message, error }` shape (global exception filter — already implemented)
- All sensitive operations logged (logging interceptor — already implemented)
- All responses transformed to consistent shape (transform interceptor — already implemented)
- No secrets in code — all via environment variables
- Sentry captures all unhandled exceptions in API and web
- E2E tests for critical user flows (auth, billing, agent sync)
- Unit tests for all service business logic

---

## 13. Environment Variables Required

### API
```
DATABASE_URL
REDIS_URL
JWT_SECRET
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
AWS_SES_FROM_EMAIL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_STARTER_PRICE_ID
STRIPE_PRO_PRICE_ID
STRIPE_ENTERPRISE_PRICE_ID
SENTRY_DSN
APP_URL
```

### Web
```
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_APP_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
NEXT_PUBLIC_SENTRY_DSN
```

### Agent
```
API_URL (stored in OS keychain after registration)
ORG_TOKEN (stored in OS keychain after registration)
```
