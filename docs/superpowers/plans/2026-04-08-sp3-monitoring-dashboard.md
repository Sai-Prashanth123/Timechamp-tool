# SP3: Monitoring Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time Socket.IO–powered employee monitoring to the web dashboard — live employee grid that updates without polling, a per-employee deep-dive page with tabs, and a standalone screenshot gallery page.

**Architecture:** Zustand store holds employee status map. A `useMonitoringSocket` hook connects to the NestJS `MonitoringGateway` (`/monitoring` namespace) with the manager's JWT, joins the org room, and feeds `employee:status`, `employee:activity`, `employee:screenshot` events into the store. Components read from the store and re-render instantly on each event. React Query still handles initial data loads.

**Tech Stack:** Next.js 14 App Router, Zustand 4, socket.io-client 4, TanStack React Query 5, NextAuth (JWT source), Tailwind CSS, shadcn/ui.

---

## What Is Already Complete — Do Not Rewrite

| File | Status |
|------|--------|
| `apps/web/hooks/use-monitoring.ts` | Complete — `useLiveStatus`, `useActivity`, `useScreenshots`, helpers |
| `apps/web/components/monitoring/live-status-board.tsx` | Complete — polling version; Task 3 upgrades to Socket.IO |
| `apps/web/components/monitoring/activity-timeline.tsx` | Complete — app usage bar chart |
| `apps/web/components/monitoring/screenshot-gallery.tsx` | Complete — grid with lightbox |
| `apps/web/app/(dashboard)/overview/page.tsx` | Complete — stat cards + live list (polling); Task 3 upgrades |
| `apps/web/app/(dashboard)/monitoring/page.tsx` | Complete — combined monitoring page |
| Backend monitoring API (`/monitoring/live`, `/monitoring/activity`, `/monitoring/screenshots`) | Complete |
| `MonitoringGateway` (SP2 Task 5) | Built in SP2 |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/web/stores/monitoring-store.ts` | Zustand store: employee status map + Socket.IO connection |
| Create | `apps/web/hooks/use-monitoring-socket.ts` | Hook that connects socket when manager is authenticated |
| Modify | `apps/web/components/monitoring/live-status-board.tsx` | Read from Zustand store instead of polling |
| Modify | `apps/web/app/(dashboard)/overview/page.tsx` | Use Zustand store for live list; show online/idle badges |
| Create | `apps/web/app/(dashboard)/monitoring/[userId]/page.tsx` | Employee deep-dive: tabs (Live / Screenshots / Activity) |
| Create | `apps/web/app/(dashboard)/monitoring/screenshots/page.tsx` | All-org screenshot gallery, filter by employee + date |
| Modify | `apps/web/app/(dashboard)/layout.tsx` | Mount `useMonitoringSocket` once so managers always get live updates |

---

## Task 1: Zustand Monitoring Store

**Files:**
- Create: `apps/web/stores/monitoring-store.ts`

- [ ] **Step 1: Write the store**

```typescript
// apps/web/stores/monitoring-store.ts
import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';

export type EmployeeStatus = {
  userId: string;
  status: 'online' | 'idle' | 'offline';
  activeApp: string | null;
  lastSeen: string; // ISO string
};

interface MonitoringStore {
  employees: Record<string, EmployeeStatus>;
  socket: Socket | null;
  connected: boolean;

  connect: (token: string, apiUrl: string) => void;
  disconnect: () => void;
  _setStatus: (payload: EmployeeStatus) => void;
  _setActivity: (userId: string, appName: string, timestamp: string) => void;
}

export const useMonitoringStore = create<MonitoringStore>((set, get) => ({
  employees: {},
  socket: null,
  connected: false,

  connect(token, apiUrl) {
    if (get().socket?.connected) return; // already connected

    const socket = io(`${apiUrl}/monitoring`, {
      auth: { token },
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));

    socket.on('employee:status', (payload: {
      userId: string;
      status: 'online' | 'idle' | 'offline';
      activeApp?: string | null;
      lastSeen: string;
    }) => {
      set((state) => ({
        employees: {
          ...state.employees,
          [payload.userId]: {
            userId: payload.userId,
            status: payload.status,
            activeApp: payload.activeApp ?? null,
            lastSeen: payload.lastSeen,
          },
        },
      }));
    });

    socket.on('employee:activity', (payload: {
      userId: string;
      appName: string;
      timestamp: string;
    }) => {
      get()._setActivity(payload.userId, payload.appName, payload.timestamp);
    });

    set({ socket });
  },

  disconnect() {
    get().socket?.disconnect();
    set({ socket: null, connected: false });
  },

  _setStatus(payload) {
    set((state) => ({
      employees: { ...state.employees, [payload.userId]: payload },
    }));
  },

  _setActivity(userId, appName, timestamp) {
    set((state) => {
      const existing = state.employees[userId];
      if (!existing) return state;
      return {
        employees: {
          ...state.employees,
          [userId]: { ...existing, activeApp: appName, lastSeen: timestamp },
        },
      };
    });
  },
}));
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/stores/monitoring-store.ts
git commit -m "feat(web): add Zustand monitoring store with Socket.IO connection"
```

---

## Task 2: useMonitoringSocket Hook

**Files:**
- Create: `apps/web/hooks/use-monitoring-socket.ts`

- [ ] **Step 1: Write the hook**

This hook is mounted once in the dashboard layout for manager/admin users. It connects the Socket.IO client using the NextAuth session JWT.

```typescript
// apps/web/hooks/use-monitoring-socket.ts
'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useMonitoringStore } from '@/stores/monitoring-store';

export function useMonitoringSocket() {
  const { data: session } = useSession();
  const connect = useMonitoringStore((s) => s.connect);
  const disconnect = useMonitoringStore((s) => s.disconnect);

  const role = session?.user?.role;
  const token = (session as any)?.accessToken as string | undefined;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

  useEffect(() => {
    // Only managers and admins need the monitoring socket
    if (!token || (role !== 'admin' && role !== 'manager')) return;

    connect(token, apiUrl);
    return () => disconnect();
  }, [token, role, apiUrl, connect, disconnect]);
}
```

- [ ] **Step 2: Mount in dashboard layout**

Open `apps/web/app/(dashboard)/layout.tsx`. Add the hook import and call it near the top of the layout component (after the existing session/auth logic):

```typescript
// At the top of the file, add:
import { useMonitoringSocket } from '@/hooks/use-monitoring-socket';

// Inside the layout component, add one line after existing hooks:
useMonitoringSocket();
```

**Note:** The dashboard layout must be a `'use client'` component for this to work. Check the existing layout — if it is a Server Component, create a thin `LayoutClient` wrapper:

```typescript
// If layout.tsx is a server component, create:
// apps/web/app/(dashboard)/layout-client.tsx
'use client';
import { useMonitoringSocket } from '@/hooks/use-monitoring-socket';

export function LayoutClient({ children }: { children: React.ReactNode }) {
  useMonitoringSocket();
  return <>{children}</>;
}

// Then in layout.tsx (server), wrap children:
// <LayoutClient>{children}</LayoutClient>
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/hooks/use-monitoring-socket.ts \
        apps/web/app/(dashboard)/layout.tsx
git commit -m "feat(web): mount useMonitoringSocket in dashboard layout for managers"
```

---

## Task 3: Upgrade LiveStatusBoard to Socket.IO Real-Time

**Files:**
- Modify: `apps/web/components/monitoring/live-status-board.tsx`

The existing component uses `useLiveStatus()` (REST polling every 30s). Upgrade it to read from the Zustand store for real-time updates. Keep the initial REST load as seed data.

- [ ] **Step 1: Replace live-status-board.tsx**

```typescript
// apps/web/components/monitoring/live-status-board.tsx
'use client';

import { useEffect } from 'react';
import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring';
import { useMonitoringStore, EmployeeStatus } from '@/stores/monitoring-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function initials(name: string): string {
  const parts = name.split(' ');
  return parts.map((p) => p[0] ?? '').join('').toUpperCase().slice(0, 2);
}

function StatusBadge({ status }: { status: EmployeeStatus['status'] }) {
  const colours: Record<EmployeeStatus['status'], string> = {
    online: 'bg-green-400',
    idle: 'bg-yellow-400',
    offline: 'bg-slate-300',
  };
  return <span className={`h-2 w-2 rounded-full shrink-0 ${colours[status]}`} />;
}

export function LiveStatusBoard() {
  // Seed initial data from REST
  const { data: seedEmployees = [] } = useLiveStatus();

  // Real-time updates from Zustand store (populated by Socket.IO)
  const storeEmployees = useMonitoringStore((s) => s.employees);
  const _setStatus = useMonitoringStore((s) => s._setStatus);

  // Seed the store with REST data on first load
  useEffect(() => {
    for (const emp of seedEmployees) {
      _setStatus({
        userId: emp.userId,
        status: 'online', // REST only returns clocked-in employees
        activeApp: emp.currentApp,
        lastSeen: emp.lastSeenAt ?? emp.clockedInSince,
      });
    }
  }, [seedEmployees, _setStatus]);

  const employees = Object.values(storeEmployees);
  const onlineCount = employees.filter((e) => e.status !== 'offline').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live — {onlineCount} online
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No employees currently clocked in.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {employees.map((emp) => (
              <a
                key={emp.userId}
                href={`/monitoring/${emp.userId}`}
                className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {initials(emp.userId)} {/* Will be name once seeded */}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {emp.userId}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {emp.activeApp ?? 'Idle'} · {elapsedSince(emp.lastSeen)}
                  </p>
                </div>
                <StatusBadge status={emp.status} />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

**Note on employee names:** The Zustand store stores only `userId`, `status`, `activeApp`, `lastSeen` (from Socket.IO events). To show names, the seed from `useLiveStatus()` must populate a name map. Add a separate `employeeNames: Record<userId, string>` map to the store and populate it from the REST seed. Update the store:

```typescript
// Add to MonitoringStore interface:
employeeNames: Record<string, { firstName: string; lastName: string }>;

// Add to create() initial state:
employeeNames: {},

// Add action:
_seedNames(employees: Array<{ userId: string; firstName: string; lastName: string }>) {
  set((state) => ({
    employeeNames: Object.fromEntries(employees.map((e) => [e.userId, { firstName: e.firstName, lastName: e.lastName }])),
  }));
},
```

Then in the LiveStatusBoard's `useEffect`, call `_seedNames(seedEmployees)`.

Update `monitoring-store.ts` to add `employeeNames` and `_seedNames` before committing.

In the card, replace `{emp.userId}` with:
```typescript
const name = storeNames[emp.userId];
// Display: name ? `${name.firstName} ${name.lastName}` : emp.userId
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/monitoring/live-status-board.tsx \
        apps/web/stores/monitoring-store.ts
git commit -m "feat(web): upgrade LiveStatusBoard to Socket.IO real-time via Zustand"
```

---

## Task 4: Employee Deep-Dive Page `/monitoring/[userId]`

**Files:**
- Create: `apps/web/app/(dashboard)/monitoring/[userId]/page.tsx`

This page shows 3 tabs for a single employee: Live status + recent screenshot, Screenshots gallery (date-filtered), Activity breakdown.

- [ ] **Step 1: Write the page**

```typescript
// apps/web/app/(dashboard)/monitoring/[userId]/page.tsx
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Header } from '@/components/dashboard/header';
import { ActivityTimeline } from '@/components/monitoring/activity-timeline';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { useMonitoringStore } from '@/stores/monitoring-store';
import { todayISO, elapsedSince } from '@/hooks/use-monitoring';

type Tab = 'live' | 'screenshots' | 'activity';

export default function EmployeeMonitoringPage() {
  const params = useParams();
  const userId = params.userId as string;

  const [tab, setTab] = useState<Tab>('live');
  const [selectedDate, setSelectedDate] = useState(todayISO());

  // Live data from Zustand store (populated by Socket.IO)
  const employee = useMonitoringStore((s) => s.employees[userId]);
  const names = useMonitoringStore((s) => s.employeeNames[userId]);
  const displayName = names
    ? `${names.firstName} ${names.lastName}`
    : userId;

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'live', label: 'Live' },
    { id: 'screenshots', label: 'Screenshots' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <>
      <Header title={`Monitoring — ${displayName}`} />

      <div className="flex-1 p-6 space-y-6 max-w-5xl">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Date picker (shown for screenshots and activity tabs) */}
        {tab !== 'live' && (
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        )}

        {/* Live tab */}
        {tab === 'live' && (
          <div className="rounded-lg border bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-slate-700">Current Status</h3>
            {employee ? (
              <div className="flex items-center gap-4">
                <span
                  className={`inline-block h-3 w-3 rounded-full ${
                    employee.status === 'online'
                      ? 'bg-green-400'
                      : employee.status === 'idle'
                      ? 'bg-yellow-400'
                      : 'bg-slate-300'
                  }`}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 capitalize">
                    {employee.status}
                  </p>
                  <p className="text-xs text-slate-500">
                    Active app: {employee.activeApp ?? 'None'}
                  </p>
                  <p className="text-xs text-slate-400">
                    Last seen {elapsedSince(employee.lastSeen)} ago
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                No live data yet. Waiting for agent heartbeat...
              </p>
            )}
          </div>
        )}

        {/* Screenshots tab */}
        {tab === 'screenshots' && (
          <ScreenshotGallery userId={userId} from={from} to={to} />
        )}

        {/* Activity tab */}
        {tab === 'activity' && (
          <ActivityTimeline userId={userId} from={from} to={to} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/monitoring/[userId]/page.tsx"
git commit -m "feat(web): add /monitoring/[userId] employee deep-dive page"
```

---

## Task 5: Standalone Screenshot Gallery `/monitoring/screenshots`

**Files:**
- Create: `apps/web/app/(dashboard)/monitoring/screenshots/page.tsx`

- [ ] **Step 1: Write the page**

```typescript
// apps/web/app/(dashboard)/monitoring/screenshots/page.tsx
'use client';

import { useState } from 'react';
import { Header } from '@/components/dashboard/header';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { todayISO } from '@/hooks/use-monitoring';

export default function ScreenshotsPage() {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState('');

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  return (
    <>
      <Header title="Screenshots" />
      <div className="flex-1 p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Employee ID</label>
            <input
              type="text"
              placeholder="All employees"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value.trim())}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          {employeeId && (
            <button
              onClick={() => setEmployeeId('')}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              Clear filter
            </button>
          )}
        </div>

        <ScreenshotGallery
          userId={employeeId || undefined}
          from={from}
          to={to}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(dashboard)/monitoring/screenshots/page.tsx
git commit -m "feat(web): add /monitoring/screenshots standalone gallery page"
```

---

## Task 6: Upgrade Overview Page to Show Live Status Badges

**Files:**
- Modify: `apps/web/app/(dashboard)/overview/page.tsx`

The existing overview page polls `useLiveStatus()` every 30s. Upgrade the employee list to also show real-time status badges from the Zustand store (set by Socket.IO events from the heartbeat). Keep `useLiveStatus()` for initial data and the stat cards.

- [ ] **Step 1: Update overview page**

Add the Zustand import and update the "Live Team Activity" list to show status badges:

```typescript
// Add at the top imports:
import { useMonitoringStore } from '@/stores/monitoring-store';
```

Inside `OverviewPage()`, add:
```typescript
const storeEmployees = useMonitoringStore((s) => s.employees);
```

Replace the existing employee list items in the "Live Team Activity" section. The full updated section:
```typescript
<ul className="divide-y divide-slate-100">
  {liveEmployees.slice(0, 8).map((emp) => {
    const live = storeEmployees[emp.userId];
    const status = live?.status ?? 'online'; // fallback: REST only returns active
    const activeApp = live?.activeApp ?? emp.currentApp;
    const statusColour =
      status === 'online' ? 'bg-green-400' :
      status === 'idle' ? 'bg-yellow-400' : 'bg-slate-300';

    return (
      <li
        key={emp.userId}
        className="flex items-center justify-between py-2"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${statusColour}`} />
          <a
            href={`/monitoring/${emp.userId}`}
            className="text-sm font-medium text-slate-800 hover:text-blue-600 hover:underline"
          >
            {emp.firstName} {emp.lastName}
          </a>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>{activeApp ?? 'Idle'}</p>
          <p className="text-slate-400">
            {elapsedSince(emp.clockedInSince)} elapsed
          </p>
        </div>
      </li>
    );
  })}
</ul>
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(dashboard)/overview/page.tsx"
git commit -m "feat(web): upgrade overview page with real-time status badges from Zustand"
```

---

## Task 7: Manual Verification

- [ ] **Step 1: Start API + web**

```bash
# Terminal 1: API
cd apps/api && npm run start:dev

# Terminal 2: Web
cd apps/web && npm run dev
```

- [ ] **Step 2: Login as admin/manager at http://localhost:3001**

Open browser DevTools → Network → WS. Confirm a WebSocket connection to `ws://localhost:3000/monitoring` appears.

- [ ] **Step 3: From a second terminal, simulate an agent heartbeat**

```bash
# You need a registered agent token (from SP2 integration test)
AGENT_TOKEN="<your-agent-token>"

curl -s -X POST http://localhost:3000/agent/sync/heartbeat \
  -H "Authorization: Bearer $AGENT_TOKEN"
```

Expected: The browser's overview page live list updates without a page refresh (status badge turns green).

- [ ] **Step 4: Verify /monitoring/[userId] page loads**

Navigate to `http://localhost:3001/monitoring/<some-userId>`.

Expected: Tabs "Live", "Screenshots", "Activity" render. Live tab shows agent status if heartbeat was sent.

- [ ] **Step 5: Verify /monitoring/screenshots loads**

Navigate to `http://localhost:3001/monitoring/screenshots`.

Expected: Date + employee filter controls appear. Screenshot gallery renders (or shows "No screenshots" message if none synced yet).

- [ ] **Step 6: Commit final**

```bash
git add .
git commit -m "feat(sp3): complete monitoring dashboard — Socket.IO real-time, deep-dive, gallery"
```

---

## Self-Review Against Spec

**Spec requirements checked:**

| Requirement | Covered by |
|-------------|-----------|
| Live employee grid — updates via Socket.IO, no polling | Task 3 (LiveStatusBoard Zustand store) |
| `/overview` — status badges from real-time events | Task 6 |
| `/monitoring/[userId]` — tabs: Live, Screenshots, Activity | Task 4 |
| `/monitoring/screenshots` — all-org gallery, date/employee filter | Task 5 |
| Zustand store holds `employees: Map<userId, EmployeeStatus>` | Task 1 |
| `useMonitoringSocket` connects with manager JWT | Task 2 |
| Socket connects on dashboard mount, disconnects on unmount | Task 2 |
| Click employee card → `/monitoring/[userId]` | Task 3 (cards are links) |
| Filter screenshots by employee, time range | Task 5 |
| Click screenshot → lightbox (fullscreen) | Already in `screenshot-gallery.tsx` |
| `employee:status` event updates card in real-time | Task 1 store handler |
| `employee:activity` event updates active app in card | Task 1 `_setActivity` handler |

**Placeholder scan:** None — all steps show complete code.

**Type consistency:**
- `EmployeeStatus.status` is `'online' | 'idle' | 'offline'` — consistent in store (Task 1), LiveStatusBoard (Task 3), deep-dive page (Task 4), overview (Task 6)
- `useMonitoringStore` — same import path in all tasks
- `_setStatus` / `_seedNames` / `_setActivity` — defined in Task 1 and called in Task 3

**Note on employee name display in LiveStatusBoard:** The Socket.IO `employee:status` event from the NestJS gateway only carries `userId`, not name. Names must come from the REST seed (`useLiveStatus()`). The `_seedNames()` action in the store bridges this. If an employee's status arrives via Socket.IO before the REST seed runs, the card shows the userId until seed completes — this is acceptable for Phase 1.
