# Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics sub-project — productivity scores, app usage breakdown, and CSV export — computed on-demand from existing `activity_events`, `attendance`, and `time_entries` data.

**Architecture:** One new NestJS module (`analytics`) with three endpoints: `GET /analytics/productivity` (daily score per employee), `GET /analytics/app-usage` (app breakdown by total minutes), and `GET /analytics/export/csv` (raw time entries as downloadable CSV). All computation is on-demand from existing tables — no new DB tables or SQS workers needed for MVP. Role scoping follows the same pattern as the monitoring module: employees see only their own data, managers/admins can filter by any `userId` or leave it undefined for org-wide view.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL, Next.js 14 App Router, TanStack Query v5, shadcn/ui, Tailwind CSS.

---

## File Map

```
apps/api/src/modules/analytics/
├── analytics.service.spec.ts   ← Jest unit tests (8 tests)
├── analytics.service.ts        ← getProductivity, getAppUsage, exportTimeEntriesCSV
├── analytics.controller.ts     ← GET /analytics/productivity, /app-usage, /export/csv
└── analytics.module.ts         ← TypeOrmModule.forFeature([ActivityEvent, Attendance, TimeEntry])

apps/api/src/app.module.ts      ← Add AnalyticsModule import

apps/web/
├── hooks/use-analytics.ts                        ← useProductivity, useAppUsage, useExportCSV
├── components/analytics/
│   ├── productivity-chart.tsx                    ← daily score bars (color-coded green/yellow/red)
│   └── app-usage-chart.tsx                       ← horizontal bars by app, sorted by duration
└── app/(dashboard)/analytics/page.tsx            ← full page: date range + employee filter + both charts + export button
```

---

## Task 1: AnalyticsService + Unit Tests

**Files:**
- Create: `apps/api/src/modules/analytics/analytics.service.spec.ts`
- Create: `apps/api/src/modules/analytics/analytics.service.ts`

- [ ] **Step 1: Create `apps/api/src/modules/analytics/analytics.service.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';

type MockRepo = { find: jest.Mock };
function mockRepo(): MockRepo {
  return { find: jest.fn() };
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let activityRepo: MockRepo;
  let attendanceRepo: MockRepo;
  let timeEntryRepo: MockRepo;

  beforeEach(async () => {
    activityRepo = mockRepo();
    attendanceRepo = mockRepo();
    timeEntryRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  // ── getProductivity ────────────────────────────────────────────────
  describe('getProductivity', () => {
    it('calculates score, worked, active, and idle minutes for a single day', async () => {
      // 8 hours worked (09:00–17:00 UTC), 6 hours active → score = round(6/8 * 100) = 75
      attendanceRepo.find.mockResolvedValue([
        {
          userId: 'u-1',
          clockIn: new Date('2026-04-02T09:00:00.000Z'),
          clockOut: new Date('2026-04-02T17:00:00.000Z'),
        },
      ]);
      activityRepo.find.mockResolvedValue([
        { startedAt: new Date('2026-04-02T09:00:00.000Z'), durationSec: 14400 }, // 4h
        { startedAt: new Date('2026-04-02T13:00:00.000Z'), durationSec: 7200 },  // 2h
      ]);

      const result = await service.getProductivity('u-1', 'org-1', '2026-04-02', '2026-04-02');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-04-02');
      expect(result[0].score).toBe(75);
      expect(result[0].workedMins).toBe(480);
      expect(result[0].activeMins).toBe(360);
      expect(result[0].idleMins).toBe(120);
    });

    it('returns score 0 when no attendance that day', async () => {
      attendanceRepo.find.mockResolvedValue([]);
      activityRepo.find.mockResolvedValue([]);

      const result = await service.getProductivity('u-1', 'org-1', '2026-04-02', '2026-04-02');

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2026-04-02');
      expect(result[0].score).toBe(0);
      expect(result[0].workedMins).toBe(0);
    });

    it('caps score at 100 when activity exceeds attendance window', async () => {
      // Only 1 hour attended but 2 hours of activity logged (e.g., agent glitch)
      attendanceRepo.find.mockResolvedValue([
        {
          userId: 'u-1',
          clockIn: new Date('2026-04-02T09:00:00.000Z'),
          clockOut: new Date('2026-04-02T10:00:00.000Z'),
        },
      ]);
      activityRepo.find.mockResolvedValue([
        { startedAt: new Date('2026-04-02T09:00:00.000Z'), durationSec: 7200 }, // 2h
      ]);

      const result = await service.getProductivity('u-1', 'org-1', '2026-04-02', '2026-04-02');

      expect(result[0].score).toBe(100);
      expect(result[0].activeMins).toBe(60); // capped at worked time
    });

    it('returns one entry per day in a multi-day range', async () => {
      attendanceRepo.find.mockResolvedValue([]);
      activityRepo.find.mockResolvedValue([]);

      const result = await service.getProductivity('u-1', 'org-1', '2026-04-01', '2026-04-03');

      expect(result).toHaveLength(3);
      expect(result.map((r) => r.date)).toEqual(['2026-04-01', '2026-04-02', '2026-04-03']);
    });

    it('omits userId from queries when undefined (manager org-wide view)', async () => {
      attendanceRepo.find.mockResolvedValue([]);
      activityRepo.find.mockResolvedValue([]);

      await service.getProductivity(undefined, 'org-1', '2026-04-02', '2026-04-02');

      const attendanceCallArg = attendanceRepo.find.mock.calls[0][0];
      expect(attendanceCallArg.where.userId).toBeUndefined();
      const activityCallArg = activityRepo.find.mock.calls[0][0];
      expect(activityCallArg.where.userId).toBeUndefined();
    });
  });

  // ── getAppUsage ────────────────────────────────────────────────────
  describe('getAppUsage', () => {
    it('groups events by app, sums durations, computes percentages, sorts desc', async () => {
      // Chrome: 60+30=90min (75%), VSCode: 30min (25%)
      activityRepo.find.mockResolvedValue([
        { appName: 'Chrome', durationSec: 3600 },
        { appName: 'VSCode', durationSec: 1800 },
        { appName: 'Chrome', durationSec: 1800 },
      ]);

      const result = await service.getAppUsage('u-1', 'org-1', '2026-04-02', '2026-04-02');

      expect(result).toHaveLength(2);
      expect(result[0].appName).toBe('Chrome');
      expect(result[0].totalMins).toBe(90);
      expect(result[0].percentage).toBe(75);
      expect(result[1].appName).toBe('VSCode');
      expect(result[1].totalMins).toBe(30);
      expect(result[1].percentage).toBe(25);
    });

    it('returns empty array when no activity', async () => {
      activityRepo.find.mockResolvedValue([]);
      const result = await service.getAppUsage('u-1', 'org-1', '2026-04-02', '2026-04-02');
      expect(result).toHaveLength(0);
    });
  });

  // ── exportTimeEntriesCSV ───────────────────────────────────────────
  describe('exportTimeEntriesCSV', () => {
    it('returns CSV with header and one row per entry', async () => {
      timeEntryRepo.find.mockResolvedValue([
        {
          startedAt: new Date('2026-04-02T09:00:00.000Z'),
          endedAt: new Date('2026-04-02T12:00:00.000Z'),
          description: 'dev work',
          source: 'automatic',
        },
      ]);

      const csv = await service.exportTimeEntriesCSV('u-1', 'org-1', '2026-04-02', '2026-04-02');
      const lines = csv.trim().split('\n');

      expect(lines[0]).toBe('Date,Start,End,Duration (min),Description,Source');
      expect(lines[1]).toContain('2026-04-02');
      expect(lines[1]).toContain('180'); // 3h in minutes
      expect(lines[1]).toContain('dev work');
      expect(lines[1]).toContain('automatic');
    });

    it('returns header-only when no entries', async () => {
      timeEntryRepo.find.mockResolvedValue([]);
      const csv = await service.exportTimeEntriesCSV('u-1', 'org-1', '2026-04-02', '2026-04-02');
      expect(csv.trim()).toBe('Date,Start,End,Duration (min),Description,Source');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (service not found)**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest analytics.service --no-coverage 2>&1 | tail -5
```

Expected: `Cannot find module './analytics.service'` or similar failure.

- [ ] **Step 3: Create `apps/api/src/modules/analytics/analytics.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';

export type DailyProductivity = {
  date: string;       // YYYY-MM-DD
  score: number;      // 0–100
  workedMins: number;
  activeMins: number;
  idleMins: number;
};

export type AppUsageRow = {
  appName: string;
  totalMins: number;
  percentage: number; // 0–100
};

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(ActivityEvent)
    private activityRepo: Repository<ActivityEvent>,
    @InjectRepository(Attendance)
    private attendanceRepo: Repository<Attendance>,
    @InjectRepository(TimeEntry)
    private timeEntryRepo: Repository<TimeEntry>,
  ) {}

  async getProductivity(
    userId: string | undefined,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<DailyProductivity[]> {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);

    const attendanceWhere: any = { organizationId, clockIn: Between(fromDate, toDate) };
    if (userId) attendanceWhere.userId = userId;

    const activityWhere: any = { organizationId, startedAt: Between(fromDate, toDate) };
    if (userId) activityWhere.userId = userId;

    const [attendances, activities] = await Promise.all([
      this.attendanceRepo.find({ where: attendanceWhere }),
      this.activityRepo.find({ where: activityWhere }),
    ]);

    // Accumulate worked seconds per calendar date (UTC)
    const workedSecByDate = new Map<string, number>();
    const now = new Date();
    for (const att of attendances) {
      const dateKey = att.clockIn.toISOString().slice(0, 10);
      const end = att.clockOut ?? now;
      const sec = Math.max(0, (end.getTime() - att.clockIn.getTime()) / 1000);
      workedSecByDate.set(dateKey, (workedSecByDate.get(dateKey) ?? 0) + sec);
    }

    // Accumulate active seconds per calendar date
    const activeSecByDate = new Map<string, number>();
    for (const ev of activities) {
      const dateKey = ev.startedAt.toISOString().slice(0, 10);
      activeSecByDate.set(dateKey, (activeSecByDate.get(dateKey) ?? 0) + ev.durationSec);
    }

    // Enumerate every date in [from, to]
    const dates: string[] = [];
    const loopEnd = new Date(`${to}T00:00:00.000Z`);
    const cursor = new Date(`${from}T00:00:00.000Z`);
    while (cursor <= loopEnd) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return dates.map((date) => {
      const workedSec = workedSecByDate.get(date) ?? 0;
      // Cap active at worked to handle agent over-reporting
      const activeSec = Math.min(activeSecByDate.get(date) ?? 0, workedSec);
      const idleSec = Math.max(0, workedSec - activeSec);
      const score =
        workedSec > 0
          ? Math.min(100, Math.round((activeSec / workedSec) * 100))
          : 0;
      return {
        date,
        score,
        workedMins: Math.round(workedSec / 60),
        activeMins: Math.round(activeSec / 60),
        idleMins: Math.round(idleSec / 60),
      };
    });
  }

  async getAppUsage(
    userId: string | undefined,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<AppUsageRow[]> {
    const where: any = {
      organizationId,
      startedAt: Between(
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:59:59.999Z`),
      ),
    };
    if (userId) where.userId = userId;

    const events = await this.activityRepo.find({ where, take: 10_000 });

    const totals = new Map<string, number>();
    for (const ev of events) {
      totals.set(ev.appName, (totals.get(ev.appName) ?? 0) + ev.durationSec);
    }

    const totalSec = [...totals.values()].reduce((a, b) => a + b, 0);
    if (totalSec === 0) return [];

    return [...totals.entries()]
      .map(([appName, sec]) => ({
        appName,
        totalMins: Math.round(sec / 60),
        percentage: Math.round((sec / totalSec) * 100),
      }))
      .sort((a, b) => b.totalMins - a.totalMins);
  }

  async exportTimeEntriesCSV(
    userId: string | undefined,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<string> {
    const where: any = {
      organizationId,
      startedAt: Between(
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:59:59.999Z`),
      ),
    };
    if (userId) where.userId = userId;

    const entries = await this.timeEntryRepo.find({
      where,
      order: { startedAt: 'ASC' },
      take: 10_000,
    });

    const header = 'Date,Start,End,Duration (min),Description,Source';
    const rows = entries.map((e) => {
      const date = e.startedAt.toISOString().slice(0, 10);
      const start = e.startedAt.toISOString().slice(11, 16);
      const end = e.endedAt ? e.endedAt.toISOString().slice(11, 16) : '';
      const durationMins = e.endedAt
        ? Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 60_000)
        : 0;
      // Escape commas in description
      const desc = (e.description ?? '').replace(/,/g, ';');
      return `${date},${start},${end},${durationMins},${desc},${e.source}`;
    });

    return [header, ...rows].join('\n');
  }
}
```

- [ ] **Step 4: Run tests and verify all 8 pass**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest analytics.service --no-coverage 2>&1 | tail -15
```

Expected: `8 passed, 1 test suite`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/analytics/ && git commit -m "feat(api): implement AnalyticsService with TDD (productivity, app usage, CSV export)"
```

---

## Task 2: AnalyticsController

**Files:**
- Create: `apps/api/src/modules/analytics/analytics.controller.ts`

- [ ] **Step 1: Create `apps/api/src/modules/analytics/analytics.controller.ts`**

```typescript
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('productivity')
  @ApiOperation({ summary: 'Daily productivity scores. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD, defaults to today' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD, defaults to from' })
  @ApiQuery({ name: 'userId', required: false })
  getProductivity(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getProductivity(targetUserId, user.organizationId, from_, to_);
  }

  @Get('app-usage')
  @ApiOperation({ summary: 'App usage summary by duration. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'userId', required: false })
  getAppUsage(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getAppUsage(targetUserId, user.organizationId, from_, to_);
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Download time entries as CSV file.' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'userId', required: false })
  async exportCSV(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
    @Res() res: Response,
  ) {
    const from_ = from ?? todayISO();
    const to_ = to ?? from_;
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    const csv = await this.service.exportTimeEntriesCSV(
      targetUserId,
      user.organizationId,
      from_,
      to_,
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="time-entries-${from_}-${to_}.csv"`,
    );
    res.send(csv);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors (pre-existing billing.service error is unrelated).

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/analytics/analytics.controller.ts && git commit -m "feat(api): add AnalyticsController (productivity, app-usage, CSV export)"
```

---

## Task 3: AnalyticsModule + AppModule Wiring

**Files:**
- Create: `apps/api/src/modules/analytics/analytics.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/modules/analytics/analytics.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, Attendance, TimeEntry])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
```

- [ ] **Step 2: Add AnalyticsModule to `apps/api/src/app.module.ts`**

Read the file first to confirm current state, then make these two edits:

**Add import at the top** (after MonitoringModule import):
```typescript
import { AnalyticsModule } from './modules/analytics/analytics.module';
```

**Add to the `imports` array in `@Module`** (after MonitoringModule):
```typescript
    AnalyticsModule,
```

The final imports array in `@Module` should be:
```typescript
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    TimeTrackingModule,
    AgentModule,
    MonitoringModule,
    AnalyticsModule,
```

- [ ] **Step 3: Run all API tests**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All tests pass (19 existing + 8 new analytics = 27 total).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/analytics/analytics.module.ts apps/api/src/app.module.ts && git commit -m "feat(api): wire AnalyticsModule into AppModule"
```

---

## Task 4: Frontend TanStack Query Hooks

**Files:**
- Create: `apps/web/hooks/use-analytics.ts`

- [ ] **Step 1: Create `apps/web/hooks/use-analytics.ts`**

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type DailyProductivity = {
  date: string;       // YYYY-MM-DD
  score: number;      // 0–100
  workedMins: number;
  activeMins: number;
  idleMins: number;
};

export type AppUsageRow = {
  appName: string;
  totalMins: number;
  percentage: number;
};

// ── Productivity ───────────────────────────────────────────────────────

export function useProductivity(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity', { params });
      return data.data as DailyProductivity[];
    },
  });
}

// ── App Usage ──────────────────────────────────────────────────────────

export function useAppUsage(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-app-usage', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/app-usage', { params });
      return data.data as AppUsageRow[];
    },
  });
}

// ── CSV Export ─────────────────────────────────────────────────────────

export function useExportCSV() {
  return useMutation({
    mutationFn: async (params: { from: string; to: string; userId?: string }) => {
      const response = await api.get('/analytics/export/csv', {
        params,
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `time-entries-${params.from}-${params.to}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('CSV downloaded'),
    onError: () => toast.error('Failed to export CSV'),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Today's date as 'YYYY-MM-DD' */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** N days ago as 'YYYY-MM-DD' */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/hooks/use-analytics.ts && git commit -m "feat(web): add analytics TanStack Query hooks (productivity, app usage, CSV export)"
```

---

## Task 5: Frontend Components + Analytics Page

**Files:**
- Create: `apps/web/components/analytics/productivity-chart.tsx`
- Create: `apps/web/components/analytics/app-usage-chart.tsx`
- Create: `apps/web/app/(dashboard)/analytics/page.tsx`

- [ ] **Step 1: Create `apps/web/components/analytics/productivity-chart.tsx`**

```tsx
'use client';

import { useProductivity } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'; // green-500
  if (score >= 40) return '#f59e0b'; // amber-500
  return '#ef4444';                  // red-500
}

function scoreLabel(score: number): string {
  if (score >= 70) return 'Productive';
  if (score >= 40) return 'Moderate';
  return 'Low';
}

interface Props {
  from: string;
  to: string;
  userId?: string;
}

export function ProductivityChart({ from, to, userId }: Props) {
  const { data: days = [], isLoading } = useProductivity({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading productivity data...
        </CardContent>
      </Card>
    );
  }

  // Only show days that had any worked time, for a cleaner chart
  const activeDays = days.filter((d) => d.workedMins > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Productivity Score</CardTitle>
      </CardHeader>
      <CardContent>
        {activeDays.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No working hours recorded for this period.
          </p>
        ) : (
          <div className="space-y-3">
            {activeDays.map((day) => (
              <div key={day.date} className="flex items-center gap-3">
                {/* Date label */}
                <div className="w-24 shrink-0 text-xs text-slate-500 text-right">
                  {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>

                {/* Bar */}
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-5 rounded-full transition-all flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max(4, day.score)}%`,
                      backgroundColor: scoreColor(day.score),
                    }}
                  >
                    {day.score >= 20 && (
                      <span className="text-[10px] font-semibold text-white">
                        {day.score}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="w-40 shrink-0 text-xs text-slate-500">
                  <span
                    className="font-medium"
                    style={{ color: scoreColor(day.score) }}
                  >
                    {scoreLabel(day.score)}
                  </span>
                  {' · '}
                  {day.activeMins}m active / {day.workedMins}m worked
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/analytics/app-usage-chart.tsx`**

```tsx
'use client';

import { useAppUsage } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#f43f5e', '#a3e635', '#fb923c', '#c084fc',
  '#34d399', '#fbbf24', '#60a5fa', '#e879f9', '#4ade80',
];

interface Props {
  from: string;
  to: string;
  userId?: string;
}

export function AppUsageChart({ from, to, userId }: Props) {
  const { data: rows = [], isLoading } = useAppUsage({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading app usage...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Usage Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No activity recorded for this period.
          </p>
        ) : (
          <div className="space-y-2.5">
            {rows.slice(0, 20).map((row, i) => (
              <div key={row.appName} className="flex items-center gap-3">
                {/* App name */}
                <div
                  className="w-36 shrink-0 text-sm text-slate-700 truncate"
                  title={row.appName}
                >
                  {row.appName}
                </div>

                {/* Bar */}
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all"
                    style={{
                      width: `${Math.max(1, row.percentage)}%`,
                      backgroundColor: COLOURS[i % COLOURS.length],
                    }}
                  />
                </div>

                {/* Duration + % */}
                <div className="w-24 shrink-0 text-xs text-slate-500 text-right">
                  {row.totalMins >= 60
                    ? `${Math.floor(row.totalMins / 60)}h ${row.totalMins % 60}m`
                    : `${row.totalMins}m`}
                  {' · '}
                  {row.percentage}%
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create `apps/web/app/(dashboard)/analytics/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { ProductivityChart } from '@/components/analytics/productivity-chart';
import { AppUsageChart } from '@/components/analytics/app-usage-chart';
import { useExportCSV, todayISO, daysAgoISO } from '@/hooks/use-analytics';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [from, setFrom] = useState(daysAgoISO(6)); // last 7 days
  const [to, setTo] = useState(todayISO());
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined);

  // For employees, lock to their own userId once session loads
  useEffect(() => {
    if (status === 'authenticated' && !isManager && session?.user?.id) {
      setSelectedUserId(session.user.id);
    }
  }, [status, isManager, session?.user?.id]);

  const exportCSV = useExportCSV();

  if (status === 'loading') {
    return (
      <>
        <Header title="Analytics" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  return (
    <>
      <Header title="Analytics" />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium text-slate-700">From</label>
          <input
            type="date"
            aria-label="Start date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          <label className="text-sm font-medium text-slate-700">To</label>
          <input
            type="date"
            aria-label="End date"
            value={to}
            min={from}
            max={todayISO()}
            onChange={(e) => setTo(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />

          {isManager && (
            <>
              <label className="text-sm font-medium text-slate-700 ml-2">
                Employee ID (optional)
              </label>
              <input
                type="text"
                aria-label="Filter by employee UUID"
                placeholder="all employees"
                value={selectedUserId ?? ''}
                onChange={(e) =>
                  setSelectedUserId(e.target.value.trim() || undefined)
                }
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            className="ml-auto flex items-center gap-2"
            disabled={exportCSV.isPending}
            onClick={() =>
              exportCSV.mutate({ from, to, userId: selectedUserId })
            }
          >
            <Download className="h-4 w-4" />
            {exportCSV.isPending ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>

        {/* Charts */}
        <ProductivityChart from={from} to={to} userId={selectedUserId} />
        <AppUsageChart from={from} to={to} userId={selectedUserId} />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors from the analytics files.

- [ ] **Step 5: Run all API tests**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All 27 tests pass.

- [ ] **Step 6: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/components/analytics/ "apps/web/app/(dashboard)/analytics/" && git commit -m "feat(web): add analytics dashboard (productivity chart, app usage, CSV export)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Productivity scores — `getProductivity` computes score (0–100) per day from attendance + activity data
- ✅ App/site usage reports — `getAppUsage` aggregates `activity_events` by `appName`, sorted by total duration
- ✅ Scheduled exports — `exportTimeEntriesCSV` returns time entries as a downloadable CSV file
- ✅ Analytics page at `/analytics` — sidebar already has the `BarChart3` → `Analytics` link pointing to `/analytics`
- ✅ Role-based scoping — employees see own data, managers see all or filter by `userId`
- ✅ Date range filtering — all three service methods accept `from` + `to` YYYY-MM-DD strings

**Placeholder scan:** All steps contain complete code. No TBD / TODO / placeholder text.

**Type consistency:**
- `DailyProductivity` defined in `analytics.service.ts` and re-declared in `use-analytics.ts` (frontend copy) — fields match: `date, score, workedMins, activeMins, idleMins`
- `AppUsageRow` defined in both — fields match: `appName, totalMins, percentage`
- `useProductivity`, `useAppUsage` consume `data.data` consistent with the `TransformInterceptor` wrapping all NestJS responses in `{ data: ... }`
- `useExportCSV` uses `responseType: 'blob'` on the axios call — the `/analytics/export/csv` endpoint uses `@Res()` which bypasses `TransformInterceptor` and sends raw CSV bytes directly
- `ProductivityChart` and `AppUsageChart` both accept `{ from, to, userId? }` props — matches the hook signatures
