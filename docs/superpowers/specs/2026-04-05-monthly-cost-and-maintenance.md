# Time Champ Clone — Monthly Cost & Maintenance Analysis
**Date:** 2026-04-05  
**Pricing:** Verified 2026-04-03 from official sources  
**Author:** Sai-Prashanth + Claude Code  

---

## Table of Contents

1. [One-Time Setup Costs (Before Launch)](#1-one-time-setup-costs-before-launch)
2. [Monthly Infrastructure Costs by Scale](#2-monthly-infrastructure-costs-by-scale)
3. [Monthly Developer Tools & Services](#3-monthly-developer-tools--services)
4. [Monthly Maintenance Tasks & Time](#4-monthly-maintenance-tasks--time)
5. [Complete Monthly Cash Outflow by Phase](#5-complete-monthly-cash-outflow-by-phase)
6. [Annual Cost Summary](#6-annual-cost-summary)
7. [Hidden Costs People Forget](#7-hidden-costs-people-forget)
8. [Cost Per User Economics](#8-cost-per-user-economics)
9. [When to Upgrade Each Service](#9-when-to-upgrade-each-service)

---

## 1. One-Time Setup Costs (Before Launch)

These are paid once. Not monthly. You pay them during the build phase.

| Item | Cost | When Needed | Notes |
|---|---|---|---|
| **Domain name (.com, Namecheap)** | $6.79 (year 1) | Day 1 | Renewal: $13.98/year |
| **Google Play Developer Account** | $25 (lifetime) | Before Android app | One-time, never renewed |
| **Apple Developer Program** | $99 (year 1) | Before iOS app | Renews $99/year |
| **EV Code Signing Certificate** | $249/year (SSL.com) | Before Windows agent release | Required for no "Unknown Publisher" warning |
| **Oracle Cloud account** | $0 | Day 1 | Free account, no card required for free tier |
| **Backblaze B2 account** | $0 | Day 1 | Free to create |
| **Cloudflare account** | $0 | Day 1 | Free plan is sufficient |
| **Brevo account** | $0 | Day 1 | Free plan is sufficient |
| **Stripe account** | $0 | Day 1 | No setup fee |
| **GitHub account** | $0 | Day 1 | Free plan covers solo dev |
| **Sentry account** | $0 | Day 1 | Free plan to start |
| **Grafana Cloud account** | $0 | Day 1 | Free plan is sufficient |
| **UptimeRobot account** | $0 | Day 1 | Free plan: 50 monitors |
| **Linear account** | $0 | Day 1 | Free plan: unlimited users, 250 issues |
| **Google Analytics** | $0 | Day 1 | Free |
| **Total One-Time (MVP)** | **$380.79** | | Domain + Google Play + Apple + EV cert |
| **Total One-Time (Pre-Mobile)** | **$130.79** | | Without Apple ($99) until mobile is ready |

---

## 2. Monthly Infrastructure Costs by Scale

### What We Use — Service by Service

#### 2.1 Oracle Cloud (Compute + Storage + Egress)

| Resource | Spec | Monthly Cost |
|---|---|---|
| A1 ARM VM1 (NestJS + NGINX + PgBouncer) | 2 OCPU / 12 GB RAM | **$0 forever** |
| A1 ARM VM2 (PostgreSQL + Valkey + Next.js) | 2 OCPU / 12 GB RAM | **$0 forever** |
| Block Storage | 200 GB NVMe (boot vols + DB data) | **$0 forever** |
| Object Storage | 20 GB (agent binary distribution) | **$0 forever** |
| Network Load Balancer | 1 NLB (routes HTTPS to VM1) | **$0 forever** |
| Egress | 10 TB/month outbound | **$0 forever** |
| **Oracle Total** | | **$0/month** |

**When Oracle starts costing money:**
- Block storage beyond 200 GB: $0.0255/GB/month
- Egress beyond 10 TB: $25/TB
- Compute beyond 4 OCPU/24 GB: $0.01/OCPU-hr

---

#### 2.2 Backblaze B2 (Screenshot & File Storage)

**Data generated per user per month:**
- Screenshots: 2,112 files × 80 KB = ~165 MB/user/month
- With 90-day retention policy: capped at 165 MB × 3 = ~495 MB/user (never grows beyond)

| Users | Total B2 Storage | Free (10 GB) | Billable | Cost/Month |
|---|---|---|---|---|
| 10 | 4.95 GB | All free | 0 GB | **$0.00** |
| 30 | 14.85 GB | 10 GB free | 4.85 GB | **$0.03** |
| 50 | 24.75 GB | 10 GB free | 14.75 GB | **$0.09** |
| 100 | 49.5 GB | 10 GB free | 39.5 GB | **$0.24** |
| 200 | 99 GB | 10 GB free | 89 GB | **$0.53** |
| 500 | 247.5 GB | 10 GB free | 237.5 GB | **$1.43** |
| 1,000 | 495 GB | 10 GB free | 485 GB | **$2.91** |
| 2,000 | 990 GB | 10 GB free | 980 GB | **$5.88** |
| 5,000 | 2,475 GB | 10 GB free | 2,465 GB | **$14.79** |

**B2 Transaction Costs:**
- Uploads (Class A): **$0 always** — free forever
- Downloads via Cloudflare CDN: **$0 always** — Bandwidth Alliance
- API list/metadata calls (Class B): 2,500 free/day → $0.0004/1,000 calls after
  - At 1,000 users: ~500 API calls/day → stays within free tier

**B2 Egress (direct, no CDN):**
- Not applicable — all file delivery goes through Cloudflare CDN → $0 egress

---

#### 2.3 Cloudflare (CDN + DNS + DDoS + SSL)

| Service | Monthly Cost |
|---|---|
| CDN (screenshot delivery) | **$0** — unlimited bandwidth, Bandwidth Alliance |
| DNS | **$0** — unlimited zones |
| DDoS protection | **$0** — included free |
| SSL termination | **$0** — included free |
| **Cloudflare Total** | **$0/month** |

**Note:** Cloudflare Free plan ToS prohibits pure video streaming through CDN. Our real-time WebSocket streams go directly through Oracle VMs — not Cloudflare. Screenshot JPEG delivery is explicitly permitted.

---

#### 2.4 Brevo (Transactional Email)

Emails sent per user per month (estimate):
- Welcome email: 1
- Weekly productivity report: 4
- Alert emails (idle, policy, attendance): 5
- Monthly summary: 1
- Total: ~11–15 emails/user/month

| Users | Emails/Month | Free Tier (9,000/mo) | Plan Needed | Cost/Month |
|---|---|---|---|---|
| 50 | 600 | Covered | Free | **$0** |
| 100 | 1,200 | Covered | Free | **$0** |
| 300 | 3,600 | Covered | Free | **$0** |
| 600 | 7,200 | Covered | Free | **$0** |
| 650 | 7,800 | Covered | Free | **$0** |
| 700 | 8,400 | At limit | Free | **$0** |
| 750 | 9,000 | At limit | Free → upgrade soon | **$0** |
| 800 | 9,600 | Exceeded | Starter 20K | **$9/month** |
| 1,000 | 12,000 | Exceeded | Starter 20K | **$9/month** |
| 2,000 | 24,000 | Exceeded | Starter 40K | **$18/month** |
| 3,500 | 42,000 | Exceeded | Starter 50K | **$32/month** |
| 5,000 | 60,000 | Exceeded | Starter 100K | **$59/month** |

**Alert email risk:** If alerts fire aggressively (5/day/user), costs skyrocket. Mandatory: batch alerts, cap at 1 alert per employee per 15 minutes.

---

#### 2.5 Stripe (Payment Processing)

Stripe has no monthly fee. Costs are purely per-transaction.

**For Indian domestic cards (INR ₹499/user/month plan):**
- Stripe India domestic rate: ~2% per transaction
- GST on Stripe fees: +18% on the fee
- Effective rate: ~2.36% per transaction

**For international cards (USD $6/user/month plan):**
- Standard rate: 2.9% + $0.30 per transaction
- International card surcharge: +1.5%

| Users | Monthly Revenue (₹499 plan) | Stripe Fee (~2%) | Net After Stripe |
|---|---|---|---|
| 50 | ₹24,950 (~$300) | ~$6.00 | ~$294 |
| 100 | ₹49,900 (~$600) | ~$12.00 | ~$588 |
| 500 | ₹2,49,500 (~$3,000) | ~$60.00 | ~$2,940 |
| 1,000 | ₹4,99,000 (~$6,000) | ~$120.00 | ~$5,880 |
| 5,000 | ₹24,95,000 (~$30,000) | ~$600.00 | ~$29,400 |

**Important:** The $0.30 fixed fee matters less at ₹499 (~$6) because we're charging monthly. If we switch to weekly billing, the fixed fee per charge becomes very painful (5% of transaction value).

---

#### 2.6 Upstash Redis (Overflow Cache — If Needed)

Default: Valkey is self-hosted on Oracle VM2 at $0. Upstash is only used if Oracle VMs have memory pressure.

| Plan | Storage | Commands/Month | Cost |
|---|---|---|---|
| Free | 256 MB | 500,000 | **$0** |
| Pay-as-you-go | Up to limits | 500K free then $0.20/100K | Variable |
| Fixed 250 MB | 250 MB | Unlimited | **$10/month** |

**At what user count does self-hosted Valkey face memory pressure?**
- Valkey using ~1 GB RAM for cache + pub/sub handles up to ~5,000 concurrent users
- With 12 GB on VM2, Valkey can scale to 10,000+ users before memory is a concern
- Upstash is a fallback only — not expected in the MVP phase

---

#### 2.7 PostgreSQL Paid Block Storage (Future)

Only needed when approaching 200 GB Oracle limit — expected at ~4,000 users with retention policy.

| Extra Storage | Monthly Cost |
|---|---|
| +100 GB Oracle block | $2.55/month |
| +200 GB Oracle block | $5.10/month |
| +500 GB Oracle block | $12.75/month |
| Hetzner AX42 (migration, 12 cores, 64 GB, 1 TB NVMe) | ~$86/month |

---

## 3. Monthly Developer Tools & Services

### 3.1 Code & Repository

| Tool | Free Tier | When to Pay | Paid Cost |
|---|---|---|---|
| **GitHub** | Unlimited private repos, 2,000 CI mins/month | When team grows or CI mins run out | $4/user/month (Team) |
| **GitHub Actions CI/CD** | 2,000 min/month (private repos) | When building more frequently | $0.008/min Linux overage |

**CI/CD usage estimate (solo developer):**
- 1 deployment per day × 5 min build = 150 min/month
- 2,000 free minutes → covers ~13 deployments/day
- Solo developer: free tier is more than sufficient

---

### 3.2 Error Tracking

| Tool | Free Tier | When to Pay | Paid Cost |
|---|---|---|---|
| **Sentry** | 5,000 errors/month, 1 user, 30-day retention | When you hire a second developer | $26/month (Team plan) |

**Error volume estimate:**
- At 100 users with a stable product: < 500 errors/month (well within free)
- At 1,000 users: ~2,000–3,000 errors/month (still within free 5,000 limit)
- Solo developer: Sentry free is sufficient until the team grows

---

### 3.3 Monitoring & Uptime

| Tool | Free Tier | When to Pay | Paid Cost |
|---|---|---|---|
| **Grafana Cloud** | 10K metric series, 50 GB logs, 3 users, 14-day retention | When retention or team size grows | PAYG ~$8/1,000 metric series |
| **UptimeRobot** | 50 monitors, 5-min check intervals, 1 status page | When you need 60-second intervals | $7/month (Solo plan) |
| **Better Stack** | 10 monitors, 1 status page, Slack+email alerts | When you need on-call phone alerts | $29/month (Responder) |

**What monitors we need (UptimeRobot free = 50 monitors):**
```
1. API server health: https://api.domain.com/health
2. Web dashboard: https://app.domain.com
3. Next.js SSR: https://app.domain.com/dashboard
4. PostgreSQL (TCP port check via internal monitor)
5. Valkey/Redis (TCP port check)
6. Agent update endpoint: https://api.domain.com/agent/version
7. Stripe webhook endpoint: https://api.domain.com/billing/webhook
8. B2 connectivity (test presigned URL generation)
Total: 8 monitors — well within 50 free
```

---

### 3.4 Project Management

| Tool | Free Tier | When to Pay | Paid Cost |
|---|---|---|---|
| **Linear** | Unlimited users, 250 active issues | When issue count exceeds 250 active | ~$8/user/month (Basic) |
| **Notion** | Solo use, 7-day history | When team needs shared docs | $10/user/month (Plus) |

**Solo developer reality:** Linear free (250 active issues) + Notion free (personal) = $0/month for the entire build phase.

---

### 3.5 API Testing & Development

| Tool | Free Tier | When to Pay | Paid Cost |
|---|---|---|---|
| **Postman** | 1 user only (Mar 2026 change) | Never — use alternatives | $19/user/month |
| **Bruno** (alternative) | Fully free, open-source, local-first | Never | $0 |
| **HTTPie** | Free CLI | Never | $0 |

**Recommendation:** Do NOT pay for Postman. Use **Bruno** (open-source, Git-friendly API client) — identical functionality, completely free, stores collections as files in the repo.

---

### 3.6 Security & SSL

| Tool | Cost |
|---|---|
| **Let's Encrypt SSL** (via Cloudflare) | **$0 forever** — auto-renewing |
| **Cloudflare Zero Trust** (admin access to Oracle VMs) | **$0** for ≤ 50 users |
| **EV Code Signing** (Windows agent) | $249/year = $20.75/month amortized |

---

### 3.7 Domain

| Item | Cost |
|---|---|
| .com domain (Namecheap) | $13.98/year = **$1.17/month** amortized |

---

## 4. Monthly Maintenance Tasks & Time

This is the real "hidden cost" — not money, but time. As a solo developer + Claude Code, here's exactly what maintenance looks like each month:

### Week 1 of Every Month (4–6 hours)

| Task | Time | Why |
|---|---|---|
| Review Grafana dashboards — API latency, error rates, DB query times | 1 hr | Catch performance regressions before customers complain |
| Review Sentry errors from last month — group, triage, fix critical ones | 1 hr | Fix bugs before they become support tickets |
| Review UptimeRobot logs — any downtime events, response time trends | 30 min | Understand reliability profile |
| Pull `npm audit` and `go mod tidy` — check for security vulnerabilities | 30 min | Dependency security hygiene |
| Apply OS security patches to Oracle VM1 and VM2 (`sudo apt update && apt upgrade`) | 1 hr | CVE patching — mandatory |
| Check B2 storage usage — growing as expected? Purge job running? | 30 min | Cost control |
| Check Oracle block storage — still below 80% threshold? | 15 min | Storage headroom |
| Check Stripe dashboard — any failed payments? Subscription churn? | 30 min | Revenue health |

---

### Week 2 of Every Month (2–4 hours)

| Task | Time | Why |
|---|---|---|
| Review customer support tickets / emails — any recurring issues? | 1 hr | Product quality signal |
| Test agent auto-update pipeline — release a test version, verify watchdog updates | 30 min | Agent update is critical, must work reliably |
| Verify database backup restored correctly (test restore to a temporary DB) | 1 hr | Backups that are never tested are useless |
| Review Brevo email deliverability — bounce rates, spam complaints | 30 min | Email reputation maintenance |
| Check PostgreSQL slow query log — any queries > 100ms? | 30 min | DB performance health |

---

### Week 3 of Every Month (2–3 hours)

| Task | Time | Why |
|---|---|---|
| Dependency updates — Next.js, NestJS, React Native Expo, Go dependencies | 1 hr | Stability + security |
| Review GitHub Actions CI/CD — any flaky tests? Build time creeping up? | 30 min | CI health |
| Check Valkey/Redis memory usage — evictions happening? Memory growing? | 30 min | Cache health |
| Review B2 cleanup queue — are old screenshots being deleted on schedule? | 30 min | Storage cost control |
| Test Stripe billing edge cases — failed payment flow, seat add/remove | 30 min | Billing correctness |

---

### Week 4 of Every Month (3–5 hours)

| Task | Time | Why |
|---|---|---|
| Monthly PgBouncer stats review — connection pool saturation? | 30 min | DB connection health |
| Verify Cloudflare analytics — CDN cache hit rate > 90%? | 30 min | CDN performance |
| Review agent crash reports — any Windows versions causing agent failures? | 1 hr | Agent reliability |
| Monthly security review — check for new CVEs in dependencies, API pen test checklist | 1 hr | Security posture |
| Update runbook with any new procedures discovered this month | 30 min | Ops documentation |
| Plan next month's feature work based on customer feedback | 1 hr | Product roadmap |

---

### As-Needed Tasks (Not Monthly — But Must Be Planned For)

| Task | Trigger | Time |
|---|---|---|
| **New customer onboarding** | Each new company signs up | 30–60 min (account setup, agent install help) |
| **Agent Windows release** | New Windows update breaks something | 2–4 hr (debug, build, test, release) |
| **Critical bug hotfix** | P0 bug reported by customer | 2–8 hr |
| **Database migration** | New feature requires schema change | 1–3 hr (write migration, test on staging, apply to prod) |
| **Stripe dispute / chargeback** | Customer claims unauthorized charge | 1–2 hr (respond to Stripe with evidence) |
| **Certificate renewal** | EV code signing cert expires (annual) | 1–2 hr |
| **Apple Developer renewal** | Annual | 30 min |
| **Oracle capacity issue** | A1 instance becomes unavailable | 2–4 hr (provision replacement or migrate to Hetzner) |

---

### Total Monthly Maintenance Time Estimate

| Phase | Users | Maintenance Hours/Month | Who Does It |
|---|---|---|---|
| MVP | 0–50 | **8–12 hours/month** | Solo developer |
| Growth | 50–500 | **12–18 hours/month** | Solo developer + Claude Code |
| Scale | 500–2,000 | **20–30 hours/month** | Solo developer (consider part-time DevOps help) |
| Enterprise | 2,000–5,000 | **40–60 hours/month** | Need 1 dedicated DevOps/SRE |

---

## 5. Complete Monthly Cash Outflow by Phase

### Phase 1: Pre-Launch & Early MVP (0–50 Users)

| Category | Service | Monthly Cost |
|---|---|---|
| **Infrastructure** | Oracle Cloud (compute + storage + egress) | $0.00 |
| | Backblaze B2 storage (< 10 GB) | $0.00 |
| | Cloudflare CDN + DNS + SSL | $0.00 |
| | Brevo email (< 9,000/month) | $0.00 |
| **Tools** | GitHub (free plan) | $0.00 |
| | Sentry (free plan, 1 user) | $0.00 |
| | Grafana Cloud (free plan) | $0.00 |
| | UptimeRobot (free plan, 50 monitors) | $0.00 |
| | Linear (free plan) | $0.00 |
| | Notion (free plan) | $0.00 |
| | Bruno API client | $0.00 |
| **Domain** | Namecheap .com ($13.98/yr ÷ 12) | $1.17 |
| **Security** | Let's Encrypt SSL | $0.00 |
| | Cloudflare Zero Trust (< 50 users) | $0.00 |
| **Amortized One-Time** | EV Code Signing ($249/yr ÷ 12) | $20.75 |
| | Apple Developer ($99/yr ÷ 12) | $8.25 |
| **Total Monthly** | | **$30.17/month** |

**Monthly revenue needed to break even: ₹499 × 5 users = ₹2,495 (~$30)**

---

### Phase 2: Small SaaS (50–500 Users)

| Category | Service | Monthly Cost (at 200 users) | Monthly Cost (at 500 users) |
|---|---|---|---|
| **Infrastructure** | Oracle Cloud | $0.00 | $0.00 |
| | Backblaze B2 (200 users × 495 MB = ~99 GB) | $0.53 | $1.43 |
| | Cloudflare | $0.00 | $0.00 |
| | Brevo email (200 users × 12 = 2,400 emails) | $0.00 | $0.00 |
| **Tools** | GitHub | $0.00 | $0.00 |
| | Sentry (free, < 5K errors) | $0.00 | $0.00 |
| | Grafana Cloud (free tier) | $0.00 | $0.00 |
| | UptimeRobot (free) | $0.00 | $0.00 |
| **Domain** | Namecheap .com | $1.17 | $1.17 |
| **Security** | EV Code Signing (amortized) | $20.75 | $20.75 |
| | Apple Developer (amortized) | $8.25 | $8.25 |
| **Stripe fees** | ~2% of revenue | ~$28.80 (200 users) | ~$72.00 (500 users) |
| **Total Monthly (infra+tools)** | | **~$30.70** | **~$31.60** |
| **Total Monthly (incl. Stripe)** | | **~$59.50** | **~$103.60** |
| **Monthly Revenue** | ₹499/user | ~$1,440 (200 users) | ~$3,600 (500 users) |
| **Net after all costs** | | **~$1,380** | **~$3,496** |

---

### Phase 3: Growing SaaS (500–2,000 Users)

At ~750 users, Brevo free tier is exhausted. Upgrade to Starter plan.

| Category | Service | 750 Users | 1,000 Users | 2,000 Users |
|---|---|---|---|---|
| **Infrastructure** | Oracle Cloud | $0 | $0 | $0 |
| | Backblaze B2 | $2.17 | $2.91 | $5.88 |
| | Cloudflare | $0 | $0 | $0 |
| | Brevo email | **$9** (Starter 20K) | $9 | $18 |
| **Tools** | GitHub | $0 | $0 | $0 |
| | Sentry | $0 | $0 | **$26** (team grows) |
| | Grafana Cloud | $0 | $0 | $0 |
| | UptimeRobot | $0 | **$7** (60-sec intervals) | $7 |
| **Domain** | .com domain | $1.17 | $1.17 | $1.17 |
| **Security** | EV Code Signing | $20.75 | $20.75 | $20.75 |
| | Apple Developer | $8.25 | $8.25 | $8.25 |
| **Stripe fees** | ~2% revenue | ~$108 | ~$144 | ~$288 |
| **Total Infra+Tools** | | **~$41** | **~$49** | **~$87** |
| **Total incl. Stripe** | | **~$149** | **~$193** | **~$375** |
| **Monthly Revenue** | | ~$5,400 | ~$7,200 | ~$14,400 |
| **Net after all costs** | | **~$5,251** | **~$7,007** | **~$14,025** |

---

### Phase 4: Scale (2,000–5,000 Users)

At ~4,000 users, Oracle block storage approaches limit. Add paid block storage.

| Category | Service | 3,000 Users | 5,000 Users |
|---|---|---|---|
| **Infrastructure** | Oracle Cloud (compute) | $0 | $0 |
| | Oracle paid block storage (+500 GB) | $0 | **$12.75** |
| | Backblaze B2 | $8.82 | $14.79 |
| | Cloudflare | $0 | $0 |
| | Brevo email | $32 (Starter 50K) | $59 (Starter 100K) |
| **Tools** | GitHub | $0 | $4 (Pro) |
| | Sentry (Team) | $26 | $26 |
| | Grafana Cloud | $0 | $0 |
| | UptimeRobot (Solo) | $7 | $7 |
| | Better Stack (on-call alerts) | $0 | **$29** |
| **Domain** | .com domain | $1.17 | $1.17 |
| **Security** | EV Code Signing | $20.75 | $20.75 |
| | Apple Developer | $8.25 | $8.25 |
| **Stripe fees** | ~2% revenue | ~$432 | ~$720 |
| **Total Infra+Tools** | | **~$104** | **~$183** |
| **Total incl. Stripe** | | **~$536** | **~$903** |
| **Monthly Revenue** | | ~$21,600 | ~$36,000 |
| **Net after all costs** | | **~$21,064** | **~$35,097** |

---

## 6. Annual Cost Summary

### Year 1 Annual Costs (Pre-Launch through ~200 Users)

| Item | Type | Annual Cost |
|---|---|---|
| Domain name (.com, Namecheap) | One-time (year 1 promo) | $6.79 |
| Google Play Developer account | One-time lifetime | $25.00 |
| Apple Developer Program | Annual recurring | $99.00 |
| EV Code Signing Certificate (SSL.com) | Annual recurring | $249.00 |
| Oracle Cloud (all services) | Infrastructure | $0.00 |
| Backblaze B2 (100 users, 90-day cap) | Infrastructure | ~$2.88 |
| Cloudflare | Infrastructure | $0.00 |
| Brevo email (under 9K/month) | Infrastructure | $0.00 |
| GitHub (free plan) | Tools | $0.00 |
| Sentry (free plan) | Tools | $0.00 |
| Grafana Cloud (free plan) | Tools | $0.00 |
| UptimeRobot (free plan) | Tools | $0.00 |
| Linear (free plan) | Tools | $0.00 |
| Stripe processing fees | Revenue share | ~2% of revenue |
| **Total Fixed Annual Cost (Year 1)** | | **$382.67** |
| **Total Fixed Monthly Amortized** | | **$31.89/month** |

### Year 2+ Annual Recurring Costs (Baseline)

| Item | Annual Cost |
|---|---|
| Domain renewal (.com) | $13.98 |
| Apple Developer renewal | $99.00 |
| EV Code Signing renewal | $249.00 |
| Backblaze B2 (scales with users) | ~$18–$180 |
| Brevo (if > 750 users) | $108–$708 |
| Sentry (if team grows) | $0–$312 |
| UptimeRobot (if upgraded) | $0–$84 |
| **Year 2 Fixed Minimum** | **$361.98** (~$30.17/month) |

---

## 7. Hidden Costs People Forget

### 7.1 Windows OS Updates Breaking the Agent

Every major Windows Update (happens 2× per year) can break:
- Input hooks (keystroke/mouse capture APIs)
- Screenshot APIs
- System tray behavior
- Windows Service registration

**Cost:** 4–8 hours of developer time × 2 times/year = **16 hours/year**  
**Mitigation:** Test agent on Windows 11 preview builds (Microsoft Insider Program — free)

---

### 7.2 Stripe Chargeback Fees

When a customer disputes a charge:
- Stripe charges **$15 per dispute** regardless of outcome
- If you win the dispute: $15 refunded
- If you lose: $15 lost + full refund to customer

**Estimate:** At 500 users, expect 1–2 chargebacks/year = $15–$30/year lost

---

### 7.3 Apple App Review Delays

- iOS app reviews take 1–3 days normally
- Bug fix releases can take 24–72 hours to go live
- Rejected submissions require resubmission — another 1–3 days
- This is a time cost, not money: **plan releases 1 week ahead**

---

### 7.4 EV Certificate Hardware Token

EV code signing certificates now require a **hardware HSM token** (YubiKey or similar) since 2023.

| Item | Cost |
|---|---|
| YubiKey 5 (one-time) | ~$50–$70 |
| Replacement if lost | Same cost |

If you use SSL.com's eSigner cloud HSM service: included in the $249/year certificate — no physical token needed. **Recommended approach.**

---

### 7.5 Customer Support Time

At 100 users, expect:
- 5–10 support emails/week (agent install issues, login problems, billing questions)
- Time: 3–5 hours/week = 12–20 hours/month

**This is the largest hidden cost** at early scale. Mitigations:
- Comprehensive in-app onboarding guide
- Intercom free plan (1 seat free) for live chat
- Help center documentation (Notion public page — free)

---

### 7.6 Backup Storage Cost

Daily pg_dump of PostgreSQL compressed to B2:
- At 500 users: PostgreSQL ~12 GB compressed to ~1.2 GB
- 30 daily backups: 36 GB
- B2 cost: 36 GB × $0.006/GB = $0.22/month

**This is already negligible** — included in B2 line item but worth calling out explicitly.

---

### 7.7 Oracle Account Risk

If Oracle decides to reclaim free tier instances (has happened historically to inactive accounts):
- Mitigation: keep a **Hetzner CX22 standby** ($4.90/month) with latest backups
- Recovery time if Oracle fails: ~4–6 hours to restore on Hetzner
- Or: keep automated Terraform scripts to recreate Oracle instances in < 30 minutes

---

### 7.8 India-Specific GST on Stripe Fees

When Stripe India processes payments:
- GST at 18% is applied on Stripe's fee (not on total revenue)
- Example: ₹499 × 2% Stripe fee = ₹9.98 fee → GST: ₹9.98 × 18% = ₹1.80
- Total charge to you per transaction: ₹11.78 (instead of ₹9.98)
- Effective Stripe rate: ~2.36% (not 2%)

At 1,000 users: extra GST cost = ~₹1,800/month (~$21.70/month)

---

## 8. Cost Per User Economics

### Infrastructure Cost Per User Per Month

| Users | Total Infra+Tools | Cost Per User/Month | Revenue Per User | Infra Margin |
|---|---|---|---|---|
| 10 | $30.17 | $3.02 | $6.00 | 49.7% (fixed costs dominate) |
| 50 | $30.17 | $0.60 | $6.00 | 90.0% |
| 100 | $30.24 | $0.30 | $6.00 | 95.0% |
| 200 | $30.70 | $0.15 | $6.00 | 97.5% |
| 500 | $31.60 | $0.063 | $6.00 | 98.9% |
| 1,000 | $49.00 | $0.049 | $6.00 | 99.2% |
| 2,000 | $87.00 | $0.044 | $6.00 | 99.3% |
| 5,000 | $183.00 | $0.037 | $6.00 | 99.4% |

**Key insight:** Fixed costs ($30/month — domain, EV cert, Apple developer) dominate at small scale. Once past 50 users, infrastructure is essentially free. At 5,000 users, infrastructure is **0.6% of revenue**.

---

### True Profitability (Infra + Stripe)

| Users | Revenue/Month | Stripe (~2%) | Infra+Tools | Net Profit | Profit Margin |
|---|---|---|---|---|---|
| 50 | $300 | $6 | $30.17 | **$263.83** | 87.9% |
| 100 | $600 | $12 | $30.24 | **$557.76** | 92.9% |
| 500 | $3,000 | $60 | $31.60 | **$2,908.40** | 96.9% |
| 1,000 | $6,000 | $120 | $49.00 | **$5,831.00** | 97.2% |
| 2,000 | $12,000 | $240 | $87.00 | **$11,673.00** | 97.3% |
| 5,000 | $30,000 | $600 | $183.00 | **$29,217.00** | 97.4% |

**The profit margin stabilizes at ~97% once past 500 users. Stripe fees are the only material cost.**

---

## 9. When to Upgrade Each Service

### Decision Matrix — Trigger Points

| Service | Current Plan | Upgrade Trigger | Next Plan | Monthly Cost Jump |
|---|---|---|---|---|
| **Brevo** | Free (9K emails) | > 750 users | Starter 20K | +$9/month |
| **Brevo** | Starter 20K | > 1,650 users | Starter 40K | +$9/month |
| **Sentry** | Free (1 user) | Second developer joins | Team plan | +$26/month |
| **UptimeRobot** | Free (5-min checks) | Any paid customer complaining about downtime detection lag | Solo plan | +$7/month |
| **Better Stack** | Free (no phone alerts) | On-call rotation needed | Responder | +$29/month |
| **GitHub** | Free | CI minutes regularly exceeded | Pro | +$4/month |
| **Oracle Block Storage** | 200 GB free | PostgreSQL > 160 GB (80% threshold) | +500 GB paid | +$12.75/month |
| **Oracle Compute** | Free (4 OCPU / 24 GB) | CPU > 70% sustained or RAM > 85% | Add Hetzner CX32 | +$8.70/month |
| **Brevo** | Starter 100K | > 6,500 users | Business 100K | +~$30/month |
| **PostgreSQL Hosting** | Oracle VM2 free | > 5,000 users sustained | Hetzner AX42 | +$86/month |
| **Valkey/Redis** | Self-hosted (Oracle) | VM2 memory pressure | Upstash Fixed 250MB | +$10/month |
| **GitHub Actions** | Free (2K min) | Regular overages | Pro (3K min) | +$4/month |

---

### Monthly Cost Growth Chart

```
Monthly Infrastructure + Tools Cost (excluding Stripe)

$200 │                                              ●  5,000 users
     │                                         ●
$150 │                                    ●
     │                         ●  3,000 users (~$104)
$100 │              ●  2,000 users (~$87)
     │    ●  1,000 users (~$49)
 $50 │●───────────────────────────────── 500 users (~$32)
     │  100 users (~$30)
 $30 │● baseline (< 200 users) 
     │
  $0 └──────────────────────────────────────────────────
      0    500  1000  1500  2000  2500  3000  3500  5000
                         Users
```

The cost curve is almost flat until 1,000 users. Growth is driven by Brevo email upgrades and (at scale) Oracle block storage addition.

---

## Summary: What You Pay Every Month

### Minimum Monthly Bill (0 → 750 Users)

```
Domain amortized:          $1.17
EV Code Signing amortized: $20.75
Apple Dev amortized:       $8.25
Backblaze B2 storage:      $0.00 → $2.17 (grows with users)
Everything else:           $0.00
─────────────────────────────────
TOTAL FIXED:               $30.17/month
STRIPE:                    ~2% of revenue (variable)
```

### First Non-Zero Infrastructure Bills (Chronological)

| When | Event | New Monthly Cost |
|---|---|---|
| Day 1 | Domain purchased | +$1.17/month (amortized) |
| Before agent release | EV cert purchased | +$20.75/month (amortized) |
| Before iOS launch | Apple Dev purchased | +$8.25/month (amortized) |
| ~30 users | B2 exceeds 10 GB free | +$0.03–$0.10/month |
| ~750 users | Brevo exceeds 9K emails/month | +$9.00/month |
| 2nd developer | Sentry free → Team | +$26.00/month |
| ~1,000+ users | UptimeRobot 60-sec checks | +$7.00/month |
| On-call needed | Better Stack Responder | +$29.00/month |
| ~4,000 users | Oracle block storage | +$12.75/month |
| ~5,000 users | Hetzner AX42 for PostgreSQL | +$86.00/month |

---

*Document version: 1.0 — 2026-04-05*  
*Pricing verified: 2026-04-03 from official sources*  
*Next review: when user count crosses 750 (Brevo upgrade trigger)*
