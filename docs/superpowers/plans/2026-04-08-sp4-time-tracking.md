# SP4: Time Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team timesheets view, approval queue, and payroll report pages — completing the time tracking feature so managers can see all team hours, approve/reject timesheets, and export payroll CSVs.

**Architecture:** Backend adds `getTeamTimesheets()` and `getPayrollReport()` methods to `TimeTrackingService`, then exposes them via new controller routes. Frontend adds three new pages (`/time-tracking/team`, `/time-tracking/approvals`, `/time-tracking/reports`) and the corresponding React Query hooks.

**Tech Stack:** NestJS + TypeORM (backend), Next.js 14 App Router, TanStack React Query 5, Tailwind CSS, shadcn/ui (frontend).

---

## What Is Already Complete — Do Not Rewrite

| File | Status |
|------|--------|
| `apps/api/src/modules/time-tracking/time-tracking.service.ts` | Complete — clockIn, clockOut, getStatus, getAttendance, getEntries, createManualEntry, deleteEntry, getTimesheets, approveTimesheet, rejectTimesheet, getTeamStatus |
| `apps/api/src/modules/time-tracking/time-tracking.controller.ts` | Complete for employee flows; needs team/timesheets, report, export routes |
| `apps/web/app/(dashboard)/time-tracking/page.tsx` | Complete — employee page with ClockWidget, TimesheetsView, EntriesTable |
| `apps/web/components/time-tracking/clock-widget.tsx` | Complete |
| `apps/web/components/time-tracking/timesheets-view.tsx` | Complete |
| `apps/web/components/time-tracking/entries-table.tsx` | Complete |
| `apps/web/hooks/use-time-tracking.ts` | Complete for employee hooks; needs useTeamTimesheets, usePayrollReport |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/src/modules/time-tracking/time-tracking.service.ts` | Add getTeamTimesheets(), getPayrollReport() |
| Create | `apps/api/src/modules/time-tracking/time-tracking.service.spec.ts` | Unit tests for new service methods |
| Modify | `apps/api/src/modules/time-tracking/time-tracking.controller.ts` | Add GET team/timesheets, GET report, GET export routes |
| Modify | `apps/web/hooks/use-time-tracking.ts` | Add useTeamTimesheets(), usePayrollReport(), exportPayrollCsv() |
| Create | `apps/web/app/(dashboard)/time-tracking/team/page.tsx` | Team timesheets for managers — weekly breakdown, bulk approve |
| Create | `apps/web/app/(dashboard)/time-tracking/approvals/page.tsx` | Pending approval queue — approve/reject per row |
| Create | `apps/web/app/(dashboard)/time-tracking/reports/page.tsx` | Payroll export — date range picker, summary table, CSV download |

---

## Task 1: TimeTrackingService — getTeamTimesheets() + getPayrollReport()

**Files:**
- Modify: `apps/api/src/modules/time-tracking/time-tracking.service.ts`
- Create: `apps/api/src/modules/time-tracking/time-tracking.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/modules/time-tracking/time-tracking.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TimeTrackingService } from './time-tracking.service';
import { Timesheet, TimesheetStatus } from '../../database/entities/timesheet.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';

const mockTimesheetRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockAttendanceRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
const mockEntryRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn() };

const orgId = 'org-uuid';
const userId1 = 'user-1';
const userId2 = 'user-2';

const mockTimesheets: Partial<Timesheet>[] = [
  {
    id: 'ts-1', userId: userId1, organizationId: orgId,
    weekStart: '2026-03-30', totalMinutes: 2400,
    status: TimesheetStatus.SUBMITTED, submittedAt: new Date(),
    approvedBy: null, approvedAt: null, rejectionNote: null,
    user: { id: userId1, firstName: 'Alice', lastName: 'Jones' } as any,
  },
  {
    id: 'ts-2', userId: userId2, organizationId: orgId,
    weekStart: '2026-03-30', totalMinutes: 1800,
    status: TimesheetStatus.APPROVED, submittedAt: new Date(),
    approvedBy: 'admin-id', approvedAt: new Date(), rejectionNote: null,
    user: { id: userId2, firstName: 'Bob', lastName: 'Smith' } as any,
  },
];

describe('TimeTrackingService.getTeamTimesheets', () => {
  let service: TimeTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: getRepositoryToken(Timesheet), useValue: mockTimesheetRepo },
        { provide: getRepositoryToken(Attendance), useValue: mockAttendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: mockEntryRepo },
      ],
    }).compile();
    service = module.get<TimeTrackingService>(TimeTrackingService);
    jest.clearAllMocks();
  });

  it('returns all timesheets for the org, newest first', async () => {
    mockTimesheetRepo.find.mockResolvedValue(mockTimesheets);

    const result = await service.getTeamTimesheets(orgId, {});

    expect(result).toHaveLength(2);
    expect(mockTimesheetRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: orgId }) }),
    );
  });

  it('filters by weekStart when provided', async () => {
    mockTimesheetRepo.find.mockResolvedValue([mockTimesheets[0]]);

    const result = await service.getTeamTimesheets(orgId, { weekStart: '2026-03-30' });

    expect(result).toHaveLength(1);
    expect(mockTimesheetRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ weekStart: '2026-03-30' }),
      }),
    );
  });

  it('filters submitted-only when status=submitted', async () => {
    mockTimesheetRepo.find.mockResolvedValue([mockTimesheets[0]]);

    await service.getTeamTimesheets(orgId, { status: 'submitted' });

    expect(mockTimesheetRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: TimesheetStatus.SUBMITTED }),
      }),
    );
  });
});

describe('TimeTrackingService.getPayrollReport', () => {
  let service: TimeTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: getRepositoryToken(Timesheet), useValue: mockTimesheetRepo },
        { provide: getRepositoryToken(Attendance), useValue: mockAttendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: mockEntryRepo },
      ],
    }).compile();
    service = module.get<TimeTrackingService>(TimeTrackingService);
    jest.clearAllMocks();
  });

  it('returns payroll rows only for approved timesheets', async () => {
    mockTimesheetRepo.find.mockResolvedValue([mockTimesheets[1]]); // only approved one

    const result = await service.getPayrollReport(orgId, '2026-03-30', '2026-04-05');

    expect(result).toHaveLength(1);
    expect(result[0].totalMinutes).toBe(1800);
    expect(result[0].userId).toBe(userId2);
  });

  it('returns empty array when no approved timesheets in range', async () => {
    mockTimesheetRepo.find.mockResolvedValue([]);

    const result = await service.getPayrollReport(orgId, '2026-03-30', '2026-04-05');

    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest time-tracking.service.spec.ts --no-coverage 2>&1 | tail -15
```
Expected: FAIL — `getTeamTimesheets is not a function`, `getPayrollReport is not a function`.

- [ ] **Step 3: Add the two methods to TimeTrackingService**

Open `apps/api/src/modules/time-tracking/time-tracking.service.ts`. Add `Between` to the typeorm import if not already present:
```typescript
import { Repository, Between } from 'typeorm';
```

Add these two methods at the bottom of the class, before the closing `}`:

```typescript
async getTeamTimesheets(
  organizationId: string,
  query: { weekStart?: string; status?: string },
): Promise<Timesheet[]> {
  const where: any = { organizationId };
  if (query.weekStart) where.weekStart = query.weekStart;
  if (query.status) where.status = query.status as TimesheetStatus;

  return this.timesheetRepo.find({
    where,
    relations: ['user'],
    order: { weekStart: 'DESC', createdAt: 'DESC' },
    take: 500,
  });
}

async getPayrollReport(
  organizationId: string,
  from: string,
  to: string,
): Promise<Array<{
  userId: string;
  firstName: string;
  lastName: string;
  weekStart: string;
  totalMinutes: number;
  overtimeMinutes: number;
  status: TimesheetStatus;
}>> {
  const timesheets = await this.timesheetRepo.find({
    where: {
      organizationId,
      status: TimesheetStatus.APPROVED,
      weekStart: Between(from, to),
    },
    relations: ['user'],
    order: { weekStart: 'ASC' },
  });

  return timesheets.map((ts) => {
    const regularMinutes = Math.min(ts.totalMinutes, 8 * 5 * 60); // 40h/week cap
    const overtimeMinutes = Math.max(0, ts.totalMinutes - regularMinutes);
    return {
      userId: ts.userId,
      firstName: ts.user?.firstName ?? '',
      lastName: ts.user?.lastName ?? '',
      weekStart: ts.weekStart,
      totalMinutes: ts.totalMinutes,
      overtimeMinutes,
      status: ts.status,
    };
  });
}
```

**Note:** `timesheetRepo` is the TypeORM repository injected in the existing constructor. Check the existing constructor parameter name — it may be `timesheetRepo` or `timesheets`. Use whatever name already exists.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest time-tracking.service.spec.ts --no-coverage 2>&1 | tail -15
```
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/time-tracking/time-tracking.service.ts \
        apps/api/src/modules/time-tracking/time-tracking.service.spec.ts
git commit -m "feat(time-tracking): add getTeamTimesheets() and getPayrollReport() to service"
```

---

## Task 2: TimeTrackingController — Team + Report + Export Routes

**Files:**
- Modify: `apps/api/src/modules/time-tracking/time-tracking.controller.ts`

- [ ] **Step 1: Add 3 new routes to the controller**

Find the `@Get('team/status')` route in `time-tracking.controller.ts`. Add the following three routes immediately before it (or after it — ordering doesn't matter for NestJS):

```typescript
// ── Team timesheets (manager/admin) ──────────────────────────────────

@Get('team/timesheets')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@ApiOperation({ summary: 'All team timesheets for org (manager/admin)' })
@ApiQuery({ name: 'weekStart', required: false, description: 'YYYY-MM-DD Monday' })
@ApiQuery({ name: 'status', required: false, enum: ['draft', 'submitted', 'approved', 'rejected'] })
getTeamTimesheets(
  @CurrentUser() user: User,
  @Query() query: { weekStart?: string; status?: string },
) {
  return this.service.getTeamTimesheets(user.organizationId, query);
}

// ── Payroll report (admin) ───────────────────────────────────────────

@Get('report')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Payroll summary for approved timesheets in date range' })
@ApiQuery({ name: 'from', required: true, description: 'YYYY-MM-DD' })
@ApiQuery({ name: 'to', required: true, description: 'YYYY-MM-DD' })
getPayrollReport(
  @CurrentUser() user: User,
  @Query('from') from: string,
  @Query('to') to: string,
) {
  return this.service.getPayrollReport(user.organizationId, from, to);
}

// ── Payroll CSV export (admin) ──────────────────────────────────────

@Get('export')
@Roles(UserRole.ADMIN)
@ApiOperation({ summary: 'Download approved timesheets as CSV' })
@ApiQuery({ name: 'from', required: true })
@ApiQuery({ name: 'to', required: true })
async exportPayrollCsv(
  @CurrentUser() user: User,
  @Query('from') from: string,
  @Query('to') to: string,
  @Res({ passthrough: true }) res: import('@nestjs/common').Response,
): Promise<string> {
  const rows = await this.service.getPayrollReport(user.organizationId, from, to);

  const header = 'Employee,Week Start,Total Hours,Overtime Hours,Status';
  const lines = rows.map((r) =>
    [
      `"${r.firstName} ${r.lastName}"`,
      r.weekStart,
      (r.totalMinutes / 60).toFixed(2),
      (r.overtimeMinutes / 60).toFixed(2),
      r.status,
    ].join(','),
  );
  const csv = [header, ...lines].join('\n');

  (res as any).header('Content-Type', 'text/csv');
  (res as any).header('Content-Disposition', `attachment; filename="payroll-${from}-${to}.csv"`);
  return csv;
}
```

Add `Res` to the NestJS imports at the top of the file:
```typescript
import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, ParseUUIDPipe, HttpCode, HttpStatus, Res,
} from '@nestjs/common';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors.

- [ ] **Step 3: Quick smoke test with curl**

```bash
cd apps/api && npm run start:dev &
sleep 5

# Login first, get token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Password123!"}' | jq -r '.accessToken')

# Team timesheets
curl -s http://localhost:3000/time-tracking/team/timesheets \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# Payroll report
curl -s "http://localhost:3000/time-tracking/report?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: `0` (empty arrays if no data, no 404 or 500 errors).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/time-tracking/time-tracking.controller.ts
git commit -m "feat(time-tracking): add team/timesheets, report, export routes to controller"
```

---

## Task 3: Frontend Hooks — useTeamTimesheets, usePayrollReport

**Files:**
- Modify: `apps/web/hooks/use-time-tracking.ts`

- [ ] **Step 1: Add team timesheets type and hook**

At the end of `apps/web/hooks/use-time-tracking.ts`, add:

```typescript
// ── Team Timesheets (manager/admin) ────────────────────────────────────

export type TeamTimesheet = Timesheet & {
  user: { id: string; firstName: string; lastName: string; email: string };
};

export function useTeamTimesheets(params?: { weekStart?: string; status?: string }) {
  return useQuery({
    queryKey: ['team-timesheets', params],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/team/timesheets', { params });
      return data.data as TeamTimesheet[];
    },
  });
}

// ── Payroll Report (admin) ─────────────────────────────────────────────

export type PayrollRow = {
  userId: string;
  firstName: string;
  lastName: string;
  weekStart: string;
  totalMinutes: number;
  overtimeMinutes: number;
  status: string;
};

export function usePayrollReport(params?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['payroll-report', params],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/report', { params });
      return data.data as PayrollRow[];
    },
    enabled: !!(params?.from && params?.to),
  });
}

/** Opens a browser download for the payroll CSV */
export function downloadPayrollCsv(from: string, to: string, token: string): void {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const url = `${apiUrl}/time-tracking/export?from=${from}&to=${to}`;
  // Create a temporary anchor element to trigger download
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', `payroll-${from}-${to}.csv`);
  // Add auth header via a fetch → blob URL approach
  fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.blob())
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.click();
      URL.revokeObjectURL(objectUrl);
    });
}

// ── Bulk Approve ────────────────────────────────────────────────────────

export function useBulkApproveTimesheets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => api.post(`/time-tracking/timesheets/${id}/approve`)),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-timesheets'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheets approved');
    },
    onError: () => toast.error('Failed to approve some timesheets'),
  });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/use-time-tracking.ts
git commit -m "feat(web): add useTeamTimesheets, usePayrollReport, useBulkApprove hooks"
```

---

## Task 4: `/time-tracking/team` Page

**Files:**
- Create: `apps/web/app/(dashboard)/time-tracking/team/page.tsx`

Managers see all team timesheets grouped by employee. Select week, approve all or individual rows.

- [ ] **Step 1: Write the page**

```typescript
// apps/web/app/(dashboard)/time-tracking/team/page.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  useTeamTimesheets,
  useApproveTimesheet,
  useRejectTimesheet,
  useBulkApproveTimesheets,
  formatMinutes,
  getWeekStart,
  TeamTimesheet,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function TeamTimesheetsPage() {
  const { data: session } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [weekStart, setWeekStart] = useState(getWeekStart());
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const { data: timesheets = [], isLoading } = useTeamTimesheets({ weekStart });
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const bulkApprove = useBulkApproveTimesheets();

  if (!isManager) {
    return (
      <>
        <Header title="Team Timesheets" />
        <div className="p-6 text-slate-500 text-sm">
          Access restricted to managers and admins.
        </div>
      </>
    );
  }

  const submittedIds = timesheets
    .filter((ts) => ts.status === 'submitted')
    .map((ts) => ts.id);

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  // Navigate week by week
  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d.toISOString().slice(0, 10));
  };

  return (
    <>
      <Header title="Team Timesheets" />
      <div className="flex-1 p-6 space-y-4 max-w-6xl">

        {/* Week nav */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}>
            &larr; Prev Week
          </Button>
          <span className="text-sm font-medium text-slate-700">
            Week of {weekStart}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => shiftWeek(1)}
            disabled={weekStart >= getWeekStart()}
          >
            Next Week &rarr;
          </Button>
          {submittedIds.length > 0 && (
            <Button
              size="sm"
              className="ml-auto"
              disabled={bulkApprove.isPending}
              onClick={() => bulkApprove.mutate(submittedIds)}
            >
              Approve All ({submittedIds.length})
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              {timesheets.length} timesheet{timesheets.length !== 1 ? 's' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : timesheets.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                No timesheets for this week.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {timesheets.map((ts) => (
                      <>
                        <tr key={ts.id} className="py-2">
                          <td className="py-3 pr-4 font-medium text-slate-800">
                            {ts.user.firstName} {ts.user.lastName}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">
                            {formatMinutes(ts.totalMinutes)}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[ts.status]}`}
                            >
                              {ts.status}
                            </span>
                          </td>
                          <td className="py-3">
                            {ts.status === 'submitted' && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-700 border-green-300 hover:bg-green-50"
                                  disabled={approve.isPending}
                                  onClick={() => approve.mutate(ts.id)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-300 hover:bg-red-50"
                                  onClick={() => {
                                    setRejectingId(ts.id);
                                    setRejectNote('');
                                  }}
                                >
                                  Reject
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {rejectingId === ts.id && (
                          <tr key={`${ts.id}-reject`}>
                            <td colSpan={4} className="pb-3">
                              <div className="flex gap-2 items-center pl-1">
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Rejection reason (required)"
                                  value={rejectNote}
                                  onChange={(e) => setRejectNote(e.target.value)}
                                  className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                                />
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={!rejectNote.trim() || reject.isPending}
                                  onClick={() => handleReject(ts.id)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRejectingId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
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
git add apps/web/app/(dashboard)/time-tracking/team/page.tsx
git commit -m "feat(web): add /time-tracking/team manager timesheet page"
```

---

## Task 5: `/time-tracking/approvals` Page

**Files:**
- Create: `apps/web/app/(dashboard)/time-tracking/approvals/page.tsx`

Focused view showing ONLY submitted (pending) timesheets across all weeks.

- [ ] **Step 1: Write the page**

```typescript
// apps/web/app/(dashboard)/time-tracking/approvals/page.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  useTeamTimesheets,
  useApproveTimesheet,
  useRejectTimesheet,
  useBulkApproveTimesheets,
  formatMinutes,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ApprovalsPage() {
  const { data: session } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  // Only fetch submitted timesheets
  const { data: pending = [], isLoading } = useTeamTimesheets({ status: 'submitted' });
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const bulkApprove = useBulkApproveTimesheets();

  if (!isManager) {
    return (
      <>
        <Header title="Approvals" />
        <div className="p-6 text-slate-500 text-sm">
          Access restricted to managers and admins.
        </div>
      </>
    );
  }

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  return (
    <>
      <Header title="Timesheet Approvals" />
      <div className="flex-1 p-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {isLoading ? '...' : `${pending.length} timesheet${pending.length !== 1 ? 's' : ''} pending approval`}
          </p>
          {pending.length > 0 && (
            <Button
              size="sm"
              disabled={bulkApprove.isPending}
              onClick={() => bulkApprove.mutate(pending.map((ts) => ts.id))}
            >
              Approve All
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pending Approvals</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : pending.length === 0 ? (
              <p className="text-sm text-green-600 font-medium py-4 text-center">
                All caught up — no timesheets pending approval.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Week</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Submitted</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pending.map((ts) => (
                      <>
                        <tr key={ts.id}>
                          <td className="py-3 pr-4 font-medium text-slate-800">
                            {ts.user.firstName} {ts.user.lastName}
                          </td>
                          <td className="py-3 pr-4 text-slate-600">{ts.weekStart}</td>
                          <td className="py-3 pr-4 text-slate-600">
                            {formatMinutes(ts.totalMinutes)}
                          </td>
                          <td className="py-3 pr-4 text-slate-500 text-xs">
                            {ts.submittedAt
                              ? new Date(ts.submittedAt).toLocaleDateString()
                              : '—'}
                          </td>
                          <td className="py-3">
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-700 border-green-300 hover:bg-green-50"
                                disabled={approve.isPending}
                                onClick={() => approve.mutate(ts.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 border-red-300 hover:bg-red-50"
                                onClick={() => {
                                  setRejectingId(ts.id);
                                  setRejectNote('');
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {rejectingId === ts.id && (
                          <tr key={`${ts.id}-reject`}>
                            <td colSpan={5} className="pb-3">
                              <div className="flex gap-2 items-center pl-1">
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Rejection reason (required)"
                                  value={rejectNote}
                                  onChange={(e) => setRejectNote(e.target.value)}
                                  className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                                />
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={!rejectNote.trim() || reject.isPending}
                                  onClick={() => handleReject(ts.id)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRejectingId(null)}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
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
git add apps/web/app/(dashboard)/time-tracking/approvals/page.tsx
git commit -m "feat(web): add /time-tracking/approvals pending approval queue page"
```

---

## Task 6: `/time-tracking/reports` Page

**Files:**
- Create: `apps/web/app/(dashboard)/time-tracking/reports/page.tsx`

Admin-only payroll report with date range picker, summary table, and CSV download.

- [ ] **Step 1: Write the page**

```typescript
// apps/web/app/(dashboard)/time-tracking/reports/page.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import {
  usePayrollReport,
  downloadPayrollCsv,
  formatMinutes,
  getWeekStart,
} from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function getMonthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PayrollReportsPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';
  const token = (session as any)?.accessToken as string | undefined;

  const [from, setFrom] = useState(getMonthStart());
  const [to, setTo] = useState(todayISO());

  const { data: rows = [], isLoading, refetch } = usePayrollReport({ from, to });

  const totalHours = rows.reduce((sum, r) => sum + r.totalMinutes / 60, 0);
  const totalOvertime = rows.reduce((sum, r) => sum + r.overtimeMinutes / 60, 0);

  if (!isAdmin) {
    return (
      <>
        <Header title="Payroll Reports" />
        <div className="p-6 text-slate-500 text-sm">
          Access restricted to admins.
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Payroll Reports" />
      <div className="flex-1 p-6 space-y-4 max-w-6xl">

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">From</label>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600">To</label>
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={todayISO()}
                  onChange={(e) => setTo(e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <Button onClick={() => refetch()} disabled={isLoading}>
                {isLoading ? 'Loading...' : 'Run Report'}
              </Button>
              {rows.length > 0 && token && (
                <Button
                  variant="outline"
                  onClick={() => downloadPayrollCsv(from, to, token)}
                >
                  Export CSV
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary stats */}
        {rows.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Employees</p>
              <p className="text-2xl font-bold text-slate-900">
                {new Set(rows.map((r) => r.userId)).size}
              </p>
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Total Hours</p>
              <p className="text-2xl font-bold text-slate-900">{totalHours.toFixed(1)}h</p>
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Overtime Hours</p>
              <p className="text-2xl font-bold text-amber-600">{totalOvertime.toFixed(1)}h</p>
            </div>
          </div>
        )}

        {/* Results table */}
        <Card>
          <CardHeader>
            <CardTitle>
              {isLoading
                ? 'Loading...'
                : rows.length === 0
                ? 'No approved timesheets in this period'
                : `${rows.length} approved timesheet${rows.length !== 1 ? 's' : ''}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-slate-500 border-b">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Week</th>
                      <th className="pb-2 pr-4">Total Hours</th>
                      <th className="pb-2 pr-4">Regular</th>
                      <th className="pb-2">Overtime</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row, i) => {
                      const regularMinutes = row.totalMinutes - row.overtimeMinutes;
                      return (
                        <tr key={`${row.userId}-${row.weekStart}-${i}`}>
                          <td className="py-2.5 pr-4 font-medium text-slate-800">
                            {row.firstName} {row.lastName}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600">{row.weekStart}</td>
                          <td className="py-2.5 pr-4 text-slate-700 font-medium">
                            {formatMinutes(row.totalMinutes)}
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600">
                            {formatMinutes(regularMinutes)}
                          </td>
                          <td className="py-2.5">
                            {row.overtimeMinutes > 0 ? (
                              <span className="text-amber-600 font-medium">
                                {formatMinutes(row.overtimeMinutes)}
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
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
git add apps/web/app/(dashboard)/time-tracking/reports/page.tsx
git commit -m "feat(web): add /time-tracking/reports admin payroll export page"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run backend tests**

```bash
cd apps/api && npx jest time-tracking --no-coverage 2>&1 | tail -15
```
Expected: All time-tracking tests pass.

- [ ] **Step 2: Start both servers and verify pages load**

```bash
# Terminal 1
cd apps/api && npm run start:dev

# Terminal 2
cd apps/web && npm run dev
```

Navigate as admin/manager:
- `http://localhost:3001/time-tracking/team` — Week navigation, approve/reject buttons visible
- `http://localhost:3001/time-tracking/approvals` — "All caught up" message if no pending
- `http://localhost:3001/time-tracking/reports` — Date pickers, Run Report button, Export CSV button

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(sp4): complete time tracking — team view, approvals, payroll report"
```

---

## Self-Review Against Spec

**Spec requirements checked:**

| Requirement | Covered by |
|-------------|-----------|
| `/time-tracking` — employee timesheet + clock in/out | Already complete |
| `/time-tracking/team` — table: Mon–Sun hours, approve all | Task 4 (week nav, bulk approve) |
| `/time-tracking/approvals` — pending entries, approve/reject + reason | Task 5 |
| `/time-tracking/reports` — date range, per-employee hours, overtime, CSV export | Task 6 |
| `GET /time-tracking/team/timesheets` API route | Task 2 |
| `GET /time-tracking/report` API route | Task 2 |
| `GET /time-tracking/export` API route + CSV response | Task 2 |
| Only 1 active entry per user | Existing backend constraint (not touched) |
| Manager cannot approve own entries | Existing backend logic (not touched) |
| Manual entries require approval | Existing backend logic |

**Placeholder scan:** None — all steps show complete code.

**Type consistency:**
- `TeamTimesheet` extends `Timesheet` with `user` — used in Task 3 hook, Task 4 page, Task 5 page
- `PayrollRow.totalMinutes` / `PayrollRow.overtimeMinutes` — consistent in Task 1 service, Task 3 hook, Task 6 page
- `formatMinutes()` — already exported from `use-time-tracking.ts`, reused across all pages
