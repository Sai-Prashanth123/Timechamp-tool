# Switching the Supabase Connection Pooler to Transaction Mode

## TL;DR

In your Supabase project dashboard, change the connection pooler **mode** from
**Session** to **Transaction**, then update your `DATABASE_URL` to use the
**transaction-mode pooler endpoint** (port `6543`) instead of the session-mode
endpoint (port `5432`). At the API's typical workload (lots of short queries,
few long-lived transactions), this **frees pool slots ~5-10× faster** because
slots are released after each statement instead of after each connection.

For TimeChamp at 100K agents, this is the difference between a 50-slot pool
that constantly queues vs. a 50-slot pool that has spare capacity. **Zero code
change required.**

---

## What the pooler is and why it matters

Postgres has a hard ceiling on concurrent connections — typically 100-200 even
on the largest tiers. Each connection eats memory (~10 MB) and CPU. When your
API has more concurrent requests than DB connections, requests start queueing
or failing.

A **connection pooler** (Supabase uses Supavisor) sits between your API and
Postgres, multiplexing many client connections onto a smaller fixed pool of
real Postgres connections.

The pooler can run in three modes — only two matter for our case:

| Mode | When does the pool slot get released? | When you'd use it |
|------|---------------------------------------|-------------------|
| **Session** | After the client disconnects | Long-lived stateful sessions, prepared statements, advisory locks |
| **Transaction** | After each transaction commits/rolls back (or after each statement if no transaction) | Stateless API workloads — what we have |

## Why Transaction Mode is faster for us

A typical TimeChamp API request looks like:

```
1. Client connects (gets pool slot)
2. SELECT ... FROM agent_devices WHERE token = $1   ← single statement
3. SELECT ... FROM users WHERE id = $1               ← single statement
4. Client returns response
5. Connection sits idle for next request
```

In **Session mode**, the pool slot is held for the entire duration the API
process keeps the connection alive — typically until the connection is closed
on shutdown. With 50 slots and 100K agents, the API holds 50 slots permanently
and there's nothing left for new connections.

In **Transaction mode**, the slot is released **after each statement** (or
after each `COMMIT`). A 50-slot pool can handle thousands of API requests
per second because each request only holds a slot for a few milliseconds.

**Concrete numbers**:
- Session mode at 50 slots: ~50 concurrent in-flight requests, queueing above that.
- Transaction mode at 50 slots: ~5,000-25,000 in-flight requests/sec depending on query latency.

That's the source of the "5-10× faster" claim.

---

## How to flip the switch (3 minutes)

### 1. Open the Supabase dashboard

Go to your project at https://supabase.com/dashboard and select the TimeChamp project (`kbakbqilgilltgdlowuy`).

### 2. Navigate to Database → Connection Pooler

Left sidebar → **Project Settings** → **Database** → scroll down to
**Connection Pooler** section.

### 3. Find the connection string panels

You'll see two panels:

- **Direct connection** (port 5432) — bypasses the pooler entirely. **Don't use this for the API.**
- **Connection pooling** — the pooler endpoints. There are usually two URI panels here: one labeled **Session** (port 5432 of the pooler) and one labeled **Transaction** (port 6543).

### 4. Copy the Transaction-mode URI

It'll look something like:

```
postgresql://postgres.kbakbqilgilltgdlowuy:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

Note the **port 6543** (not 5432) and the **`pooler.supabase.com` host** (not the direct DB host).

### 5. Update your API's `.env` file

In `apps/api/.env`, replace:

```bash
DATABASE_URL=postgresql://...:5432/postgres   # session-mode pooler or direct
```

with:

```bash
DATABASE_URL=postgresql://...:6543/postgres   # transaction-mode pooler
```

### 6. Restart the API

```bash
cd apps/api
npx nest start --watch
```

---

## What you'll observe

| Metric | Before (session mode) | After (transaction mode) |
|--------|----------------------|--------------------------|
| **Idle connections to Postgres** | ≈ pool max (50) constantly | Variable, scales with load |
| **Time a request waits for a slot during burst** | 100ms-30s | <10ms |
| **`context deadline exceeded` errors during Supabase slow windows** | Frequent | Rare |
| **`pg_stat_activity` count** | Pegged at pool max | Fluctuates |

---

## Important caveats

### Things that DON'T work in Transaction mode

Transaction mode releases the pool slot at every transaction boundary, which
means **per-session state is lost** between statements. The features that
break:

1. **Prepared statements** — the next statement may run on a different real
   Postgres connection that doesn't have the prepared statement registered.
   - **TypeORM impact:** TypeORM disables prepared statements by default when
     using postgres driver in pooler mode. If you ever enable them explicitly,
     re-think it.

2. **Advisory locks** (`pg_advisory_lock`) — released between statements.
   - **TimeChamp impact:** none, we don't use advisory locks.

3. **`SET LOCAL` / session variables** — same problem.
   - **TimeChamp impact:** none, we don't set session variables.

4. **`LISTEN/NOTIFY`** — the LISTEN session is killed when the slot is
   released.
   - **TimeChamp impact:** none today. If we ever use Postgres pub/sub for
     real-time events, we'd need to use a separate direct connection for the
     listener.

5. **Server-side cursors** that span multiple statements.
   - **TimeChamp impact:** none, we use offset/limit pagination.

### What DOES still work

- Multi-statement transactions wrapped in `BEGIN ... COMMIT` (the slot is
  held for the duration of the transaction, then released).
- Standard SELECT/INSERT/UPDATE/DELETE.
- pgmq operations (we just verified — they're transactional).
- TypeORM's standard query patterns.

---

## How to verify it's working

After restarting the API with the new `DATABASE_URL`, run this query via the
Supabase MCP or `psql`:

```sql
SELECT
  state,
  COUNT(*) AS connections,
  MAX(NOW() - state_change) AS oldest_in_state
FROM pg_stat_activity
WHERE datname = 'postgres'
  AND application_name LIKE '%postgres%'
GROUP BY state
ORDER BY state;
```

In **session mode** you'll see:
```
state  | connections | oldest_in_state
-------+-------------+----------------
idle   |     50      |   01:34:00      ← pegged at max, idle for hours
active |      2      |   00:00:00.150
```

In **transaction mode** you'll see:
```
state  | connections | oldest_in_state
-------+-------------+----------------
idle   |     5       |   00:00:01      ← fluctuates, low idle time
active |     12      |   00:00:00.020
```

If the `idle` count drops significantly and `oldest_in_state` for idle drops
to seconds instead of hours, the switch is working.

---

## Rollback (if anything breaks)

Just change `DATABASE_URL` back to the session-mode endpoint (port 5432) and
restart. No code or schema changes are tied to the pooler mode.

If you discover an unexpected dependency on session-level state (e.g. a
library you didn't know was using prepared statements), TypeORM logs will
show the relevant SQL error. Roll back, fix the dependency, try again.
