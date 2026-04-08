# SP7: Productivity Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build productivity analytics — per-employee and org-wide charts showing app usage breakdown by productive/unproductive/neutral category, daily stacked bar charts, category donut charts, GitHub-style productivity heatmaps, and an exportable weekly report. All charts use recharts.

**Architecture:** Backend adds four new methods to `AnalyticsService` (which already exists with `getProductivity`, `getAppUsage`, `exportTimeEntriesCSV`), then exposes them via four new routes in `AnalyticsController`. Frontend adds `recharts` as a dependency, extends `use-analytics.ts` with four new hooks and date helpers, creates four new chart components, and replaces the existing analytics page with a full dashboard that includes personal charts, heatmap, and team table.

**Tech Stack:** NestJS + TypeORM (backend), Next.js 14 App Router, TanStack React Query 5, recharts 2.x, Tailwind CSS, shadcn/ui (frontend).

---

## What Is Already Complete — Do Not Rewrite

| File | Status |
|------|--------|
| `apps/api/src/modules/analytics/analytics.service.ts` | Complete — `getProductivity`, `getAppUsage`, `exportTimeEntriesCSV`. Do not touch these methods. |
| `apps/api/src/modules/analytics/analytics.controller.ts` | Complete — `GET /analytics/productivity`, `GET /analytics/app-usage`, `GET /analytics/export/csv`. Do not touch these routes. |
| `apps/api/src/modules/analytics/analytics.module.ts` | Complete — imports ActivityEvent, Attendance, TimeEntry. Will need RedisService added if not already in module providers. |
| `apps/api/src/modules/analytics/analytics.service.spec.ts` | Complete — covers existing three methods. Add new describe blocks; do not modify existing ones. |
| `apps/web/hooks/use-analytics.ts` | Complete — `useProductivity`, `useAppUsage`, `useExportCSV`, `todayISO`, `daysAgoISO`. Extend with new exports only. |
| `apps/web/components/analytics/productivity-chart.tsx` | Complete — bar-style score chart (no recharts). Leave untouched. |
| `apps/web/components/analytics/app-usage-chart.tsx` | Complete — horizontal bar usage chart (no recharts). Leave untouched. |
| `apps/web/app/(dashboard)/analytics/page.tsx` | Complete but will be REPLACED in SP7-T4 — it currently shows ProductivityChart + AppUsageChart only. |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `apps/api/src/modules/analytics/analytics.service.ts` | Add `getProductivityReport`, `getOrgProductivitySummary`, `getAppCategoryBreakdown`, `getProductivityHeatmap` |
| Modify | `apps/api/src/modules/analytics/analytics.service.spec.ts` | Add new describe blocks for each new method |
| Modify | `apps/api/src/modules/analytics/analytics.controller.ts` | Add `GET /analytics/productivity/report`, `/summary`, `/breakdown`, `/heatmap` |
| Modify | `apps/web/hooks/use-analytics.ts` | Add `useProductivityReport`, `useProductivitySummary`, `useCategoryBreakdown`, `useHeatmap`, date helpers |
| Create | `apps/web/components/analytics/productivity-stacked-chart.tsx` | Recharts stacked BarChart — productive/unproductive/neutral per day |
| Create | `apps/web/components/analytics/category-donut.tsx` | Recharts PieChart donut — 3 slices with center label |
| Create | `apps/web/components/analytics/productivity-heatmap.tsx` | GitHub-style calendar heatmap |
| Create | `apps/web/components/analytics/team-productivity-table.tsx` | Sortable team summary table with color-coded % |
| Replace | `apps/web/app/(dashboard)/analytics/page.tsx` | Full analytics dashboard — date range, all 4 new components |

---

## Task 1: AnalyticsService — Four New Methods + Tests

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.service.ts`
- Modify: `apps/api/src/modules/analytics/analytics.service.spec.ts`

### Background: App Categorization

The new methods classify every `appName` from `ActivityEvent` into one of three categories using hardcoded lists. The lists are defined as module-level constants at the top of `analytics.service.ts`.

- [ ] **Step 1: Write the failing tests**

Add the following describe blocks at the END of `apps/api/src/modules/analytics/analytics.service.spec.ts`, after the closing `});` of the existing `describe('AnalyticsService', ...)` block. Do not change anything above.

```typescript
// ─────────────────────────────────────────────────────────────
// SP7 tests — app categorization + new analytics methods
// ─────────────────────────────────────────────────────────────

describe('AnalyticsService SP7 — getProductivityReport', () => {
  let service: AnalyticsService;
  let activityRepo: { find: jest.Mock };
  let attendanceRepo: { find: jest.Mock };
  let timeEntryRepo: { find: jest.Mock };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    activityRepo = { find: jest.fn() };
    attendanceRepo = { find: jest.fn() };
    timeEntryRepo = { find: jest.fn() };
    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('classifies VS Code as productive and YouTube as unproductive', async () => {
    activityRepo.find.mockResolvedValue([
      {
        userId: 'u-1',
        appName: 'Code',
        startedAt: new Date('2026-04-07T09:00:00.000Z'),
        durationSec: 3600, // 60 productive minutes
      },
      {
        userId: 'u-1',
        appName: 'YouTube',
        startedAt: new Date('2026-04-07T10:00:00.000Z'),
        durationSec: 1800, // 30 unproductive minutes
      },
    ]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityReport('org-1', 'u-1', '2026-04-07', '2026-04-07');

    expect(result).toHaveLength(1);
    const day = result[0];
    expect(day.date).toBe('2026-04-07');
    expect(day.productiveMinutes).toBe(60);
    expect(day.unproductiveMinutes).toBe(30);
    expect(day.neutralMinutes).toBe(0);
    expect(day.totalMinutes).toBe(90);
    expect(day.topApps).toHaveLength(2);
    expect(day.topApps[0].appName).toBe('Code');
    expect(day.topApps[0].category).toBe('productive');
  });

  it('returns an entry for every date in range even with no activity', async () => {
    activityRepo.find.mockResolvedValue([]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityReport('org-1', 'u-1', '2026-04-05', '2026-04-07');

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.date)).toEqual(['2026-04-05', '2026-04-06', '2026-04-07']);
    expect(result[0].totalMinutes).toBe(0);
  });

  it('classifies unknown apps as neutral', async () => {
    activityRepo.find.mockResolvedValue([
      {
        userId: 'u-1',
        appName: 'MyCustomApp',
        startedAt: new Date('2026-04-07T09:00:00.000Z'),
        durationSec: 600,
      },
    ]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityReport('org-1', 'u-1', '2026-04-07', '2026-04-07');

    expect(result[0].neutralMinutes).toBe(10);
    expect(result[0].productiveMinutes).toBe(0);
    expect(result[0].unproductiveMinutes).toBe(0);
    expect(result[0].topApps[0].category).toBe('neutral');
  });
});

describe('AnalyticsService SP7 — getOrgProductivitySummary', () => {
  let service: AnalyticsService;
  let activityRepo: { find: jest.Mock };
  let attendanceRepo: { find: jest.Mock };
  let timeEntryRepo: { find: jest.Mock };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    activityRepo = { find: jest.fn() };
    attendanceRepo = { find: jest.fn() };
    timeEntryRepo = { find: jest.fn() };
    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns one summary row per unique userId with correct percent', async () => {
    activityRepo.find.mockResolvedValue([
      {
        userId: 'u-1',
        appName: 'Code',          // productive
        startedAt: new Date('2026-04-07T09:00:00.000Z'),
        durationSec: 7200,        // 120 min
        user: { id: 'u-1', firstName: 'Alice', lastName: 'Smith' },
      },
      {
        userId: 'u-1',
        appName: 'YouTube',       // unproductive
        startedAt: new Date('2026-04-07T11:00:00.000Z'),
        durationSec: 3600,        // 60 min
        user: { id: 'u-1', firstName: 'Alice', lastName: 'Smith' },
      },
    ]);

    const result = await service.getOrgProductivitySummary('org-1', '2026-04-07', '2026-04-07');

    expect(result).toHaveLength(1);
    const row = result[0];
    expect(row.userId).toBe('u-1');
    expect(row.firstName).toBe('Alice');
    expect(row.lastName).toBe('Smith');
    // 120 productive out of 180 total = 66.67% → round to 67
    expect(row.productivePercent).toBe(67);
    expect(row.totalHours).toBeCloseTo(3, 0); // 180 min = 3h
    expect(row.topApp).toBe('Code');
  });

  it('returns empty array when no activity for org', async () => {
    activityRepo.find.mockResolvedValue([]);

    const result = await service.getOrgProductivitySummary('org-1', '2026-04-07', '2026-04-07');

    expect(result).toHaveLength(0);
  });
});

describe('AnalyticsService SP7 — getAppCategoryBreakdown', () => {
  let service: AnalyticsService;
  let activityRepo: { find: jest.Mock };
  let attendanceRepo: { find: jest.Mock };
  let timeEntryRepo: { find: jest.Mock };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    activityRepo = { find: jest.fn() };
    attendanceRepo = { find: jest.fn() };
    timeEntryRepo = { find: jest.fn() };
    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns 3 slices summing to 100 percent when all categories present', async () => {
    activityRepo.find.mockResolvedValue([
      { appName: 'Code', durationSec: 3600, startedAt: new Date() },       // productive 60 min
      { appName: 'YouTube', durationSec: 1800, startedAt: new Date() },    // unproductive 30 min
      { appName: 'MyApp', durationSec: 1800, startedAt: new Date() },      // neutral 30 min
    ]);

    const result = await service.getAppCategoryBreakdown('org-1', undefined, '2026-04-01', '2026-04-07');

    const totalPercent = result.reduce((sum, r) => sum + r.percent, 0);
    expect(totalPercent).toBe(100);
    const productive = result.find((r) => r.category === 'productive');
    expect(productive).toBeDefined();
    expect(productive!.minutes).toBe(60);
  });

  it('returns empty array when no activity', async () => {
    activityRepo.find.mockResolvedValue([]);

    const result = await service.getAppCategoryBreakdown('org-1', undefined, '2026-04-01', '2026-04-07');

    expect(result).toHaveLength(0);
  });
});

describe('AnalyticsService SP7 — getProductivityHeatmap', () => {
  let service: AnalyticsService;
  let activityRepo: { find: jest.Mock };
  let attendanceRepo: { find: jest.Mock };
  let timeEntryRepo: { find: jest.Mock };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    activityRepo = { find: jest.fn() };
    attendanceRepo = { find: jest.fn() };
    timeEntryRepo = { find: jest.fn() };
    redisService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('returns weeks * 7 entries for the requested number of weeks', async () => {
    activityRepo.find.mockResolvedValue([]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityHeatmap('org-1', undefined, 4);

    expect(result).toHaveLength(4 * 7);
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('productiveMinutes');
    expect(result[0]).toHaveProperty('level');
  });

  it('assigns level 0 when productiveMinutes is 0', async () => {
    activityRepo.find.mockResolvedValue([]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityHeatmap('org-1', 'u-1', 2);

    expect(result.every((r) => r.level === 0)).toBe(true);
  });

  it('assigns level 4 when a day has more than 4 hours of productive time', async () => {
    // One day with 5 hours of VS Code activity
    const dayStart = new Date('2026-04-07T09:00:00.000Z');
    activityRepo.find.mockResolvedValue([
      { appName: 'Code', durationSec: 18000, startedAt: dayStart }, // 5h
    ]);
    attendanceRepo.find.mockResolvedValue([]);

    const result = await service.getProductivityHeatmap('org-1', 'u-1', 2);

    const dayEntry = result.find((r) => r.date === '2026-04-07');
    if (dayEntry) {
      expect(dayEntry.level).toBe(4);
      expect(dayEntry.productiveMinutes).toBe(300);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && npx jest analytics.service.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `service.getProductivityReport is not a function`, `service.getOrgProductivitySummary is not a function`, `service.getAppCategoryBreakdown is not a function`, `service.getProductivityHeatmap is not a function`.

- [ ] **Step 3: Add the four new methods to AnalyticsService**

Open `apps/api/src/modules/analytics/analytics.service.ts`. Add the following constants at module level immediately after the existing imports, before the `@Injectable()` decorator:

```typescript
// ── App Categorization ──────────────────────────────────────────────────

export type AppCategory = 'productive' | 'unproductive' | 'neutral';

const PRODUCTIVE_APPS = new Set([
  // IDEs / code editors
  'code', 'vscode', 'visual studio code', 'idea', 'intellij', 'webstorm',
  'pycharm', 'goland', 'clion', 'rider', 'rubymine', 'phpstorm',
  'eclipse', 'netbeans', 'xcode', 'android studio', 'vim', 'neovim',
  'emacs', 'sublime text', 'atom', 'notepad++', 'cursor',
  // Terminal
  'terminal', 'iterm2', 'iterm', 'windows terminal', 'cmd', 'powershell',
  'bash', 'zsh', 'gnome-terminal', 'konsole', 'hyper',
  // Browsers (assumed productive — use for work)
  'chrome', 'google chrome', 'firefox', 'safari', 'edge', 'microsoft edge',
  'brave', 'opera', 'arc',
  // Design
  'figma', 'sketch', 'adobe xd', 'invision', 'zeplin', 'framer',
  'photoshop', 'illustrator', 'inkscape', 'gimp',
  // Communication & collaboration
  'slack', 'microsoft teams', 'teams', 'zoom', 'google meet', 'webex',
  'discord', 'loom',
  // Office / docs
  'word', 'microsoft word', 'excel', 'microsoft excel', 'powerpoint',
  'microsoft powerpoint', 'onenote', 'google docs', 'google sheets',
  'google slides', 'notion', 'confluence', 'jira', 'linear',
  // Dev tools
  'postman', 'insomnia', 'tableplus', 'datagrip', 'sequel pro',
  'docker desktop', 'github desktop', 'sourcetree', 'fork',
]);

const UNPRODUCTIVE_APPS = new Set([
  // Video streaming
  'youtube', 'netflix', 'hulu', 'disney+', 'twitch', 'vimeo', 'tiktok',
  'prime video', 'amazon prime video', 'hbo max', 'peacock', 'paramount+',
  // Gaming
  'steam', 'epic games', 'epicgameslauncher', 'battle.net', 'battlenet',
  'origin', 'ea app', 'ubisoft connect', 'gog galaxy',
  'minecraft', 'league of legends', 'valorant', 'fortnite', 'roblox',
  'csgo', 'counter-strike', 'dota 2', 'apex legends',
  // Social media
  'instagram', 'facebook', 'twitter', 'x', 'reddit', 'snapchat',
  'pinterest', 'tumblr', 'linkedin', // linkedin left in unproductive by design
  // Other time-sinks
  'spotify', 'apple music', 'youtube music',
  '9gag', 'buzzfeed', 'imgur',
]);

function categorizeApp(appName: string): AppCategory {
  const normalized = appName.toLowerCase().trim();
  if (PRODUCTIVE_APPS.has(normalized)) return 'productive';
  if (UNPRODUCTIVE_APPS.has(normalized)) return 'unproductive';
  return 'neutral';
}
```

Now add the four new types after the existing `AppUsageRow` type export:

```typescript
export type ProductivityReportDay = {
  date: string;           // YYYY-MM-DD
  productiveMinutes: number;
  unproductiveMinutes: number;
  neutralMinutes: number;
  totalMinutes: number;
  topApps: { appName: string; minutes: number; category: AppCategory }[];
};

export type OrgProductivitySummaryRow = {
  userId: string;
  firstName: string;
  lastName: string;
  productivePercent: number;  // 0–100 rounded
  totalHours: number;         // decimal hours, 1 dp
  topApp: string;
};

export type CategoryBreakdownSlice = {
  category: AppCategory;
  minutes: number;
  percent: number;
};

export type HeatmapDay = {
  date: string;              // YYYY-MM-DD
  productiveMinutes: number;
  level: 0 | 1 | 2 | 3 | 4; // 0=none, 1=<2h, 2=2-4h, 3=4-6h, 4=6h+
};
```

Now add the four methods at the bottom of the `AnalyticsService` class, before the closing `}`:

```typescript
// ── SP7: getProductivityReport ──────────────────────────────────────────

async getProductivityReport(
  organizationId: string,
  userId: string | undefined,
  from: string,
  to: string,
): Promise<ProductivityReportDay[]> {
  const cacheKey = `prod-report:${organizationId}:${from}:${to}:${userId ?? 'all'}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as ProductivityReportDay[];

  const where: any = {
    organizationId,
    startedAt: Between(
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`),
    ),
  };
  if (userId) where.userId = userId;

  const events = await this.activityRepo.find({ where, take: 50_000 });

  // Accumulate per-date, per-app totals
  type AppBucket = { appName: string; sec: number; category: AppCategory };
  const dayMap = new Map<string, Map<string, AppBucket>>();

  for (const ev of events) {
    const dateKey = ev.startedAt.toISOString().slice(0, 10);
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map());
    const apps = dayMap.get(dateKey)!;
    if (!apps.has(ev.appName)) {
      apps.set(ev.appName, {
        appName: ev.appName,
        sec: 0,
        category: categorizeApp(ev.appName),
      });
    }
    apps.get(ev.appName)!.sec += ev.durationSec;
  }

  // Build date range
  const dates: string[] = [];
  const loopEnd = new Date(`${to}T00:00:00.000Z`);
  const cursor = new Date(`${from}T00:00:00.000Z`);
  while (cursor <= loopEnd) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const result: ProductivityReportDay[] = dates.map((date) => {
    const apps = dayMap.get(date);
    if (!apps || apps.size === 0) {
      return {
        date,
        productiveMinutes: 0,
        unproductiveMinutes: 0,
        neutralMinutes: 0,
        totalMinutes: 0,
        topApps: [],
      };
    }

    let prodSec = 0, unprodSec = 0, neutralSec = 0;
    for (const bucket of apps.values()) {
      if (bucket.category === 'productive') prodSec += bucket.sec;
      else if (bucket.category === 'unproductive') unprodSec += bucket.sec;
      else neutralSec += bucket.sec;
    }

    const topApps = [...apps.values()]
      .sort((a, b) => b.sec - a.sec)
      .slice(0, 10)
      .map((b) => ({
        appName: b.appName,
        minutes: Math.round(b.sec / 60),
        category: b.category,
      }));

    return {
      date,
      productiveMinutes: Math.round(prodSec / 60),
      unproductiveMinutes: Math.round(unprodSec / 60),
      neutralMinutes: Math.round(neutralSec / 60),
      totalMinutes: Math.round((prodSec + unprodSec + neutralSec) / 60),
      topApps,
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const ttl = to < today ? 86400 : 300;
  await this.redis.set(cacheKey, JSON.stringify(result), ttl);
  return result;
}

// ── SP7: getOrgProductivitySummary ─────────────────────────────────────

async getOrgProductivitySummary(
  organizationId: string,
  from: string,
  to: string,
): Promise<OrgProductivitySummaryRow[]> {
  const cacheKey = `org-summary:${organizationId}:${from}:${to}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as OrgProductivitySummaryRow[];

  const events = await this.activityRepo.find({
    where: {
      organizationId,
      startedAt: Between(
        new Date(`${from}T00:00:00.000Z`),
        new Date(`${to}T23:59:59.999Z`),
      ),
    },
    relations: ['user'],
    take: 200_000,
  });

  // Aggregate per user
  type UserBucket = {
    firstName: string;
    lastName: string;
    productiveSec: number;
    totalSec: number;
    appTotals: Map<string, number>;
  };
  const userMap = new Map<string, UserBucket>();

  for (const ev of events) {
    if (!userMap.has(ev.userId)) {
      userMap.set(ev.userId, {
        firstName: ev.user?.firstName ?? '',
        lastName: ev.user?.lastName ?? '',
        productiveSec: 0,
        totalSec: 0,
        appTotals: new Map(),
      });
    }
    const bucket = userMap.get(ev.userId)!;
    bucket.totalSec += ev.durationSec;
    if (categorizeApp(ev.appName) === 'productive') {
      bucket.productiveSec += ev.durationSec;
    }
    bucket.appTotals.set(
      ev.appName,
      (bucket.appTotals.get(ev.appName) ?? 0) + ev.durationSec,
    );
  }

  const result: OrgProductivitySummaryRow[] = [...userMap.entries()].map(
    ([userId, b]) => {
      const topApp = [...b.appTotals.entries()].sort((a, z) => z[1] - a[1])[0]?.[0] ?? '';
      return {
        userId,
        firstName: b.firstName,
        lastName: b.lastName,
        productivePercent:
          b.totalSec > 0 ? Math.round((b.productiveSec / b.totalSec) * 100) : 0,
        totalHours: Math.round((b.totalSec / 3600) * 10) / 10,
        topApp,
      };
    },
  );

  // Sort by productivePercent descending
  result.sort((a, b) => b.productivePercent - a.productivePercent);

  const today = new Date().toISOString().slice(0, 10);
  const ttl = to < today ? 86400 : 300;
  await this.redis.set(cacheKey, JSON.stringify(result), ttl);
  return result;
}

// ── SP7: getAppCategoryBreakdown ────────────────────────────────────────

async getAppCategoryBreakdown(
  organizationId: string,
  userId: string | undefined,
  from: string,
  to: string,
): Promise<CategoryBreakdownSlice[]> {
  const cacheKey = `cat-breakdown:${organizationId}:${from}:${to}:${userId ?? 'all'}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as CategoryBreakdownSlice[];

  const where: any = {
    organizationId,
    startedAt: Between(
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`),
    ),
  };
  if (userId) where.userId = userId;

  const events = await this.activityRepo.find({ where, take: 50_000 });

  let prodSec = 0, unprodSec = 0, neutralSec = 0;
  for (const ev of events) {
    const cat = categorizeApp(ev.appName);
    if (cat === 'productive') prodSec += ev.durationSec;
    else if (cat === 'unproductive') unprodSec += ev.durationSec;
    else neutralSec += ev.durationSec;
  }

  const totalSec = prodSec + unprodSec + neutralSec;
  if (totalSec === 0) return [];

  const pct = (sec: number) => Math.round((sec / totalSec) * 100);

  // Ensure percentages sum to exactly 100 (give remainder to largest slice)
  const slices: CategoryBreakdownSlice[] = [
    { category: 'productive', minutes: Math.round(prodSec / 60), percent: pct(prodSec) },
    { category: 'unproductive', minutes: Math.round(unprodSec / 60), percent: pct(unprodSec) },
    { category: 'neutral', minutes: Math.round(neutralSec / 60), percent: pct(neutralSec) },
  ];
  const sumPct = slices.reduce((s, x) => s + x.percent, 0);
  if (sumPct !== 100) {
    const largest = slices.reduce((a, b) => (a.percent >= b.percent ? a : b));
    largest.percent += 100 - sumPct;
  }

  const result = slices.filter((s) => s.minutes > 0);

  const today = new Date().toISOString().slice(0, 10);
  const ttl = to < today ? 86400 : 300;
  await this.redis.set(cacheKey, JSON.stringify(result), ttl);
  return result;
}

// ── SP7: getProductivityHeatmap ─────────────────────────────────────────

async getProductivityHeatmap(
  organizationId: string,
  userId: string | undefined,
  weeks: number = 8,
): Promise<HeatmapDay[]> {
  const cacheKey = `heatmap:${organizationId}:${userId ?? 'all'}:${weeks}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as HeatmapDay[];

  // Build date range: go back `weeks` weeks from the most recent Sunday
  const today = new Date();
  // Find the most recent Sunday (end of last complete week)
  const dayOfWeek = today.getUTCDay(); // 0=Sun
  const endDate = new Date(today);
  endDate.setUTCDate(today.getUTCDate() - dayOfWeek); // last Sunday
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - weeks * 7 + 1);

  const from = startDate.toISOString().slice(0, 10);
  const to = endDate.toISOString().slice(0, 10);

  const where: any = {
    organizationId,
    startedAt: Between(
      new Date(`${from}T00:00:00.000Z`),
      new Date(`${to}T23:59:59.999Z`),
    ),
  };
  if (userId) where.userId = userId;

  const events = await this.activityRepo.find({ where, take: 200_000 });

  // Accumulate productive seconds per date
  const prodSecByDate = new Map<string, number>();
  for (const ev of events) {
    if (categorizeApp(ev.appName) !== 'productive') continue;
    const dateKey = ev.startedAt.toISOString().slice(0, 10);
    prodSecByDate.set(dateKey, (prodSecByDate.get(dateKey) ?? 0) + ev.durationSec);
  }

  // Generate all dates in range
  const result: HeatmapDay[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const loopEnd = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= loopEnd) {
    const date = cursor.toISOString().slice(0, 10);
    const productiveMinutes = Math.round((prodSecByDate.get(date) ?? 0) / 60);
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (productiveMinutes >= 360) level = 4;       // 6h+
    else if (productiveMinutes >= 240) level = 3;  // 4-6h
    else if (productiveMinutes >= 120) level = 2;  // 2-4h
    else if (productiveMinutes > 0) level = 1;     // <2h
    result.push({ date, productiveMinutes, level });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  await this.redis.set(cacheKey, JSON.stringify(result), 300);
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx jest analytics.service.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: PASS — all existing tests plus all 11 new tests green.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/analytics/analytics.service.ts \
        apps/api/src/modules/analytics/analytics.service.spec.ts
git commit -m "feat(analytics): add getProductivityReport, getOrgProductivitySummary, getAppCategoryBreakdown, getProductivityHeatmap"
```

---

## Task 2: AnalyticsController — Four New Routes

**Files:**
- Modify: `apps/api/src/modules/analytics/analytics.controller.ts`

- [ ] **Step 1: Add new imports to the controller**

At the top of `apps/api/src/modules/analytics/analytics.controller.ts`, update the import from `./analytics.service` to include the new types:

```typescript
import {
  AnalyticsService,
  ProductivityReportDay,
  OrgProductivitySummaryRow,
  CategoryBreakdownSlice,
  HeatmapDay,
} from './analytics.service';
```

Also add `Roles` decorator and `UserRole` if not already imported. The `Roles` and `RolesGuard` imports are already present. Add `ParseIntPipe` to the `@nestjs/common` import line:

```typescript
import {
  Controller,
  Get,
  Query,
  UseGuards,
  Res,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
```

- [ ] **Step 2: Add the four new routes**

Find the closing `}` of `AnalyticsController`. Insert the following four routes immediately before it:

```typescript
// ── SP7: Productivity Report (stacked daily breakdown) ──────────────────

@Get('productivity/report')
@ApiOperation({
  summary: 'Per-day productive/unproductive/neutral breakdown with top apps. Employees see own; managers can filter by userId.',
})
@ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD, defaults to 7 days ago' })
@ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD, defaults to today' })
@ApiQuery({ name: 'userId', required: false })
getProductivityReport(
  @CurrentUser() user: User,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('userId') userId?: string,
): Promise<ProductivityReportDay[]> {
  const today = todayISO();
  const from_ = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  const to_ = to ?? today;
  const targetUserId =
    user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
  return this.service.getProductivityReport(user.organizationId, targetUserId, from_, to_);
}

// ── SP7: Org Productivity Summary (team table) ──────────────────────────

@Get('productivity/summary')
@ApiOperation({
  summary: 'Per-employee productivity summary for date range. Manager/admin only.',
})
@ApiQuery({ name: 'from', required: false })
@ApiQuery({ name: 'to', required: false })
getOrgProductivitySummary(
  @CurrentUser() user: User,
  @Query('from') from?: string,
  @Query('to') to?: string,
): Promise<OrgProductivitySummaryRow[]> {
  if (user.role === UserRole.EMPLOYEE) return Promise.resolve([]);
  const today = todayISO();
  const from_ = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  const to_ = to ?? today;
  return this.service.getOrgProductivitySummary(user.organizationId, from_, to_);
}

// ── SP7: Category Breakdown (donut chart) ───────────────────────────────

@Get('productivity/breakdown')
@ApiOperation({
  summary: 'Productive/unproductive/neutral minutes as pie slices. Employees see own; managers can filter.',
})
@ApiQuery({ name: 'from', required: false })
@ApiQuery({ name: 'to', required: false })
@ApiQuery({ name: 'userId', required: false })
getAppCategoryBreakdown(
  @CurrentUser() user: User,
  @Query('from') from?: string,
  @Query('to') to?: string,
  @Query('userId') userId?: string,
): Promise<CategoryBreakdownSlice[]> {
  const today = todayISO();
  const from_ = from ?? (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();
  const to_ = to ?? today;
  const targetUserId =
    user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
  return this.service.getAppCategoryBreakdown(user.organizationId, targetUserId, from_, to_);
}

// ── SP7: Productivity Heatmap ────────────────────────────────────────────

@Get('productivity/heatmap')
@ApiOperation({
  summary: 'GitHub-style heatmap of productive minutes. Employees see own; managers can filter.',
})
@ApiQuery({ name: 'weeks', required: false, description: 'Number of weeks to show (default 8)' })
@ApiQuery({ name: 'userId', required: false })
getProductivityHeatmap(
  @CurrentUser() user: User,
  @Query('weeks', new DefaultValuePipe(8), ParseIntPipe) weeks: number,
  @Query('userId') userId?: string,
): Promise<HeatmapDay[]> {
  const targetUserId =
    user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
  return this.service.getProductivityHeatmap(user.organizationId, targetUserId, weeks);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 4: Quick smoke test with curl**

```bash
cd apps/api && npm run start:dev &
sleep 6

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Password123!"}' | jq -r '.accessToken')

# Productivity report
curl -s "http://localhost:3000/analytics/productivity/report?from=2026-04-01&to=2026-04-07" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'

# Category breakdown
curl -s "http://localhost:3000/analytics/productivity/breakdown?from=2026-04-01&to=2026-04-07" \
  -H "Authorization: Bearer $TOKEN" | jq '.data'

# Heatmap
curl -s "http://localhost:3000/analytics/productivity/heatmap?weeks=4" \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
```

Expected: numeric array lengths (0 if no data), no 404 or 500 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/analytics/analytics.controller.ts
git commit -m "feat(analytics): add productivity/report, /summary, /breakdown, /heatmap routes"
```

---

## Task 3: Frontend — Install recharts, New Hooks, Four Chart Components

**Files:**
- Install: recharts (check first)
- Modify: `apps/web/hooks/use-analytics.ts`
- Create: `apps/web/components/analytics/productivity-stacked-chart.tsx`
- Create: `apps/web/components/analytics/category-donut.tsx`
- Create: `apps/web/components/analytics/productivity-heatmap.tsx`
- Create: `apps/web/components/analytics/team-productivity-table.tsx`

### Sub-task 3a: Install recharts

- [ ] **Step 1: Check if recharts is already in package.json**

```bash
grep recharts apps/web/package.json
```

If the output shows a recharts entry, skip the install. If there is no output, install it:

```bash
cd apps/web && npm install recharts
```

Verify:

```bash
grep recharts apps/web/package.json
```
Expected: `"recharts": "^2.x.x"` (or similar).

### Sub-task 3b: Extend use-analytics.ts

- [ ] **Step 2: Add new types and hooks to `apps/web/hooks/use-analytics.ts`**

Append the following to the end of the file (after the last `export function`):

```typescript
// ── SP7 Types ──────────────────────────────────────────────────────────

export type AppCategory = 'productive' | 'unproductive' | 'neutral';

export type ProductivityReportDay = {
  date: string;
  productiveMinutes: number;
  unproductiveMinutes: number;
  neutralMinutes: number;
  totalMinutes: number;
  topApps: { appName: string; minutes: number; category: AppCategory }[];
};

export type OrgProductivitySummaryRow = {
  userId: string;
  firstName: string;
  lastName: string;
  productivePercent: number;
  totalHours: number;
  topApp: string;
};

export type CategoryBreakdownSlice = {
  category: AppCategory;
  minutes: number;
  percent: number;
};

export type HeatmapDay = {
  date: string;
  productiveMinutes: number;
  level: 0 | 1 | 2 | 3 | 4;
};

// ── SP7 Hooks ──────────────────────────────────────────────────────────

export function useProductivityReport(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity-report', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/report', { params });
      return data.data as ProductivityReportDay[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useProductivitySummary(params: {
  from: string;
  to: string;
}) {
  return useQuery({
    queryKey: ['analytics-productivity-summary', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/summary', { params });
      return data.data as OrgProductivitySummaryRow[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useCategoryBreakdown(params: {
  from: string;
  to: string;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-category-breakdown', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/breakdown', { params });
      return data.data as CategoryBreakdownSlice[];
    },
    enabled: !!(params.from && params.to),
  });
}

export function useHeatmap(params: {
  weeks?: number;
  userId?: string;
}) {
  return useQuery({
    queryKey: ['analytics-heatmap', params],
    queryFn: async () => {
      const { data } = await api.get('/analytics/productivity/heatmap', { params });
      return data.data as HeatmapDay[];
    },
  });
}

// ── SP7 Date Helpers ───────────────────────────────────────────────────

/** Returns { from, to } for the last N days (inclusive of today) */
export function lastNDays(n: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (n - 1));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/** Returns { from, to } for the current Mon–Sun week */
export function thisWeek(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10),
  };
}

/** Returns { from, to } for last Mon–Sun week */
export function lastWeek(): { from: string; to: string } {
  const t = thisWeek();
  const from = new Date(t.from);
  const to = new Date(t.to);
  from.setDate(from.getDate() - 7);
  to.setDate(to.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/** Convenience wrappers */
export const last7Days = () => lastNDays(7);
export const last30Days = () => lastNDays(30);
```

### Sub-task 3c: ProductivityStackedChart

- [ ] **Step 3: Create `apps/web/components/analytics/productivity-stacked-chart.tsx`**

```tsx
'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useProductivityReport } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  from: string;
  to: string;
  userId?: string;
}

interface ChartRow {
  date: string;
  label: string;
  productive: number;
  unproductive: number;
  neutral: number;
}

function formatDateLabel(iso: string): string {
  // Shows "Apr 7" style
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

interface TooltipPayload {
  color: string;
  name: string;
  value: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md p-3 text-sm">
      <p className="font-semibold text-slate-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-slate-600 capitalize">{p.name}:</span>
          <span className="font-medium">
            {p.value >= 60
              ? `${Math.floor(p.value / 60)}h ${p.value % 60}m`
              : `${p.value}m`}
          </span>
        </div>
      ))}
      <div className="mt-1 pt-1 border-t border-slate-100 text-slate-500">
        Total:{' '}
        {total >= 60
          ? `${Math.floor(total / 60)}h ${total % 60}m`
          : `${total}m`}
      </div>
    </div>
  );
}

export function ProductivityStackedChart({ from, to, userId }: Props) {
  const { data: days = [], isLoading } = useProductivityReport({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading productivity data...
        </CardContent>
      </Card>
    );
  }

  const chartData: ChartRow[] = days.map((d) => ({
    date: d.date,
    label: formatDateLabel(d.date),
    productive: d.productiveMinutes,
    unproductive: d.unproductiveMinutes,
    neutral: d.neutralMinutes,
  }));

  const hasAnyData = chartData.some((r) => r.productive + r.unproductive + r.neutral > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Activity Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAnyData ? (
          <p className="text-center text-slate-400 text-sm py-8">
            No activity recorded for this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
              barCategoryGap="30%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v: number) =>
                  v >= 60 ? `${Math.floor(v / 60)}h` : `${v}m`
                }
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                formatter={(value: string) =>
                  value.charAt(0).toUpperCase() + value.slice(1)
                }
              />
              <Bar
                dataKey="productive"
                stackId="a"
                fill="#22c55e"
                name="productive"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="neutral"
                stackId="a"
                fill="#94a3b8"
                name="neutral"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="unproductive"
                stackId="a"
                fill="#ef4444"
                name="unproductive"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
```

### Sub-task 3d: CategoryDonut

- [ ] **Step 4: Create `apps/web/components/analytics/category-donut.tsx`**

```tsx
'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useCategoryBreakdown, CategoryBreakdownSlice } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  from: string;
  to: string;
  userId?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  productive: '#22c55e',
  unproductive: '#ef4444',
  neutral: '#94a3b8',
};

const CATEGORY_LABELS: Record<string, string> = {
  productive: 'Productive',
  unproductive: 'Unproductive',
  neutral: 'Neutral',
};

interface TooltipPayload {
  name: string;
  value: number;
  payload: CategoryBreakdownSlice;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md p-3 text-sm">
      <p className="font-semibold capitalize" style={{ color: CATEGORY_COLORS[slice.category] }}>
        {CATEGORY_LABELS[slice.category]}
      </p>
      <p className="text-slate-600 mt-0.5">
        {slice.minutes >= 60
          ? `${Math.floor(slice.minutes / 60)}h ${slice.minutes % 60}m`
          : `${slice.minutes}m`}
        {' '}({slice.percent}%)
      </p>
    </div>
  );
}

/** Renders the center label inside the donut hole */
function CenterLabel({
  viewBox,
  productivePercent,
}: {
  viewBox?: { cx?: number; cy?: number };
  productivePercent: number;
}) {
  const { cx = 0, cy = 0 } = viewBox ?? {};
  return (
    <g>
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-slate-800 font-bold"
        style={{ fontSize: 22, fontWeight: 700 }}
      >
        {productivePercent}%
      </text>
      <text
        x={cx}
        y={cy + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontSize: 11, fill: '#64748b' }}
      >
        Productive
      </text>
    </g>
  );
}

export function CategoryDonut({ from, to, userId }: Props) {
  const { data: slices = [], isLoading } = useCategoryBreakdown({ from, to, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading breakdown...
        </CardContent>
      </Card>
    );
  }

  const productiveSlice = slices.find((s) => s.category === 'productive');
  const productivePercent = productiveSlice?.percent ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        {slices.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-8">
            No activity recorded for this period.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="percent"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {slices.map((slice) => (
                    <Cell
                      key={slice.category}
                      fill={CATEGORY_COLORS[slice.category]}
                    />
                  ))}
                  {/* @ts-expect-error recharts label prop accepts render function */}
                  <CenterLabel productivePercent={productivePercent} />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="flex justify-center gap-4 mt-2 flex-wrap">
              {slices.map((slice) => (
                <div key={slice.category} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[slice.category] }}
                  />
                  <span className="capitalize">{CATEGORY_LABELS[slice.category]}</span>
                  <span className="text-slate-400">
                    {slice.minutes >= 60
                      ? `${Math.floor(slice.minutes / 60)}h ${slice.minutes % 60}m`
                      : `${slice.minutes}m`}
                    {' '}({slice.percent}%)
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

### Sub-task 3e: ProductivityHeatmap

- [ ] **Step 5: Create `apps/web/components/analytics/productivity-heatmap.tsx`**

```tsx
'use client';

import { useHeatmap, HeatmapDay } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  weeks?: number;
  userId?: string;
}

const LEVEL_COLORS: Record<number, string> = {
  0: '#e2e8f0',  // slate-200 — no activity
  1: '#bbf7d0',  // green-200 — <2h
  2: '#4ade80',  // green-400 — 2-4h
  3: '#16a34a',  // green-600 — 4-6h
  4: '#14532d',  // green-900 — 6h+
};

const LEVEL_LABELS: Record<number, string> = {
  0: 'No activity',
  1: 'Less than 2 hours',
  2: '2–4 hours',
  3: '4–6 hours',
  4: '6+ hours',
};

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTooltip(day: HeatmapDay): string {
  const dateStr = new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const mins = day.productiveMinutes;
  const duration =
    mins >= 60
      ? `${Math.floor(mins / 60)}h ${mins % 60}m productive`
      : `${mins}m productive`;
  return `${dateStr} — ${duration}`;
}

/** Groups flat array of HeatmapDay into weeks (arrays of 7 days, Sun→Sat) */
function groupIntoWeeks(days: HeatmapDay[]): HeatmapDay[][] {
  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

function getMonthLabel(days: HeatmapDay[]): string | null {
  // Return month name for the first day in a week-column if it's the 1st or if
  // week contains a month boundary
  if (days.length === 0) return null;
  const d = new Date(`${days[0].date}T12:00:00Z`);
  if (d.getUTCDate() <= 7) {
    return d.toLocaleDateString(undefined, { month: 'short' });
  }
  return null;
}

export function ProductivityHeatmap({ weeks = 8, userId }: Props) {
  const { data: days = [], isLoading } = useHeatmap({ weeks, userId });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading heatmap...
        </CardContent>
      </Card>
    );
  }

  if (days.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          No heatmap data available.
        </CardContent>
      </Card>
    );
  }

  const weekGroups = groupIntoWeeks(days);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Productivity Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-1 items-start min-w-max">
            {/* Day-of-week labels on the left */}
            <div className="flex flex-col gap-1 mr-1 pt-5">
              {DOW_LABELS.map((dow) => (
                <div
                  key={dow}
                  className="h-[14px] text-[9px] text-slate-400 text-right leading-none flex items-center justify-end"
                  style={{ lineHeight: '14px' }}
                >
                  {dow}
                </div>
              ))}
            </div>

            {/* Week columns */}
            {weekGroups.map((week, wIdx) => {
              const monthLabel = getMonthLabel(week);
              return (
                <div key={wIdx} className="flex flex-col gap-1">
                  {/* Month label above column (or blank space) */}
                  <div className="h-4 text-[9px] text-slate-400 leading-none text-center">
                    {monthLabel ?? ''}
                  </div>

                  {/* 7 day cells */}
                  {week.map((day) => (
                    <div
                      key={day.date}
                      className="w-[14px] h-[14px] rounded-[2px] cursor-default transition-opacity hover:opacity-80"
                      style={{ backgroundColor: LEVEL_COLORS[day.level] }}
                      title={formatTooltip(day)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <span className="text-xs text-slate-400 mr-1">Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="w-[14px] h-[14px] rounded-[2px] cursor-default"
              style={{ backgroundColor: LEVEL_COLORS[level] }}
              title={LEVEL_LABELS[level]}
            />
          ))}
          <span className="text-xs text-slate-400 ml-1">More</span>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Sub-task 3f: TeamProductivityTable

- [ ] **Step 6: Create `apps/web/components/analytics/team-productivity-table.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useProductivitySummary, OrgProductivitySummaryRow } from '@/hooks/use-analytics';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUpDown, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
  from: string;
  to: string;
}

type SortKey = 'name' | 'productivePercent' | 'totalHours' | 'topApp';
type SortDir = 'asc' | 'desc';

function percentColor(pct: number): string {
  if (pct >= 70) return 'text-green-600 bg-green-50';
  if (pct >= 50) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

function TrendIcon({ pct }: { pct: number }) {
  if (pct >= 70) return <TrendingUp className="h-4 w-4 text-green-500" aria-hidden="true" />;
  if (pct >= 50) return <Minus className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  return <TrendingDown className="h-4 w-4 text-red-500" aria-hidden="true" />;
}

function SortButton({
  column,
  current,
  dir,
  onSort,
}: {
  column: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (col: SortKey) => void;
}) {
  return (
    <button
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors"
      aria-label={`Sort by ${column}`}
    >
      <ArrowUpDown
        className={`h-3 w-3 ${current === column ? 'text-blue-500' : 'text-slate-300'}`}
        aria-hidden="true"
      />
    </button>
  );
}

export function TeamProductivityTable({ from, to }: Props) {
  const { data: rows = [], isLoading } = useProductivitySummary({ from, to });
  const [sortKey, setSortKey] = useState<SortKey>('productivePercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (col: SortKey) => {
    if (col === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir('desc');
    }
  };

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name':
        cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
        break;
      case 'productivePercent':
        cmp = a.productivePercent - b.productivePercent;
        break;
      case 'totalHours':
        cmp = a.totalHours - b.totalHours;
        break;
      case 'topApp':
        cmp = a.topApp.localeCompare(b.topApp);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team Productivity Overview</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-6">Loading team data...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">
            No activity recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-100">
                  <th className="pb-3 pr-4 font-medium">
                    Employee
                    <SortButton column="name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="pb-3 pr-4 font-medium">
                    Productive %
                    <SortButton column="productivePercent" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="pb-3 pr-4 font-medium">
                    Total Hours
                    <SortButton column="totalHours" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="pb-3 pr-4 font-medium">
                    Top App
                    <SortButton column="topApp" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="pb-3 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {sorted.map((row: OrgProductivitySummaryRow) => (
                  <tr key={row.userId} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 pr-4 font-medium text-slate-800">
                      {row.firstName} {row.lastName}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${percentColor(row.productivePercent)}`}
                      >
                        {row.productivePercent}%
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {row.totalHours.toFixed(1)}h
                    </td>
                    <td className="py-3 pr-4 text-slate-600 truncate max-w-[160px]" title={row.topApp}>
                      {row.topApp || '—'}
                    </td>
                    <td className="py-3">
                      <TrendIcon pct={row.productivePercent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors. If recharts types are missing, install them:
```bash
cd apps/web && npm install -D @types/recharts 2>/dev/null || true
```
(recharts 2.x ships its own types — the above command may warn "not found" which is fine.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/hooks/use-analytics.ts \
        apps/web/components/analytics/productivity-stacked-chart.tsx \
        apps/web/components/analytics/category-donut.tsx \
        apps/web/components/analytics/productivity-heatmap.tsx \
        apps/web/components/analytics/team-productivity-table.tsx \
        apps/web/package.json \
        apps/web/package-lock.json
git commit -m "feat(web): add analytics hooks, recharts-based stacked chart, donut, heatmap, team table"
```

---

## Task 4: Analytics Page — Full Dashboard

**Files:**
- Replace: `apps/web/app/(dashboard)/analytics/page.tsx`

This replaces the existing page entirely. The old `ProductivityChart` and `AppUsageChart` are preserved in other pages or remain available; the new page uses the SP7 components instead.

- [ ] **Step 1: Write the new analytics page**

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { ProductivityStackedChart } from '@/components/analytics/productivity-stacked-chart';
import { CategoryDonut } from '@/components/analytics/category-donut';
import { ProductivityHeatmap } from '@/components/analytics/productivity-heatmap';
import { TeamProductivityTable } from '@/components/analytics/team-productivity-table';
import { useExportCSV, last7Days, last30Days, thisWeek, lastWeek, todayISO } from '@/hooks/use-analytics';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

type PresetKey = '7d' | '30d' | 'thisWeek' | 'lastWeek' | 'custom';

interface DateRange {
  from: string;
  to: string;
}

function getPresetRange(preset: PresetKey): DateRange {
  switch (preset) {
    case '7d': return last7Days();
    case '30d': return last30Days();
    case 'thisWeek': return thisWeek();
    case 'lastWeek': return lastWeek();
    default: return last7Days();
  }
}

export default function AnalyticsPage() {
  const { data: session, status } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [preset, setPreset] = useState<PresetKey>('7d');
  const [customFrom, setCustomFrom] = useState(last7Days().from);
  const [customTo, setCustomTo] = useState(todayISO());

  const range: DateRange =
    preset === 'custom'
      ? { from: customFrom, to: customTo }
      : getPresetRange(preset);

  const userId = isManager ? undefined : (session?.user?.id ?? undefined);

  const exportCSV = useExportCSV();

  const handlePreset = useCallback((key: PresetKey) => {
    setPreset(key);
  }, []);

  if (status === 'loading') {
    return (
      <>
        <Header title="Analytics" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const presets: { key: PresetKey; label: string }[] = [
    { key: '7d', label: 'Last 7 Days' },
    { key: '30d', label: 'Last 30 Days' },
    { key: 'thisWeek', label: 'This Week' },
    { key: 'lastWeek', label: 'Last Week' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <>
      <Header title="Analytics" />

      <div className="p-6 space-y-6 max-w-7xl">

        {/* ── Date Range Controls ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Preset buttons */}
          <div className="flex rounded-md border border-slate-200 overflow-hidden">
            {presets.map((p) => (
              <button
                key={p.key}
                onClick={() => handlePreset(p.key)}
                className={[
                  'px-3 py-1.5 text-sm transition-colors border-r border-slate-200 last:border-r-0',
                  preset === p.key
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date inputs (visible only when preset=custom) */}
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 sr-only">From</label>
              <input
                type="date"
                aria-label="Custom start date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <span className="text-slate-400 text-sm">to</span>
              <input
                type="date"
                aria-label="Custom end date"
                value={customTo}
                min={customFrom}
                max={todayISO()}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          )}

          {/* Export CSV */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto flex items-center gap-2"
            disabled={exportCSV.isPending}
            onClick={() => exportCSV.mutate({ from: range.from, to: range.to, userId })}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportCSV.isPending ? 'Exporting\u2026' : 'Export CSV'}
          </Button>
        </div>

        {/* ── My Productivity Section ─────────────────────────────────── */}
        <section aria-labelledby="my-productivity-heading">
          <h2
            id="my-productivity-heading"
            className="text-base font-semibold text-slate-800 mb-3"
          >
            {isManager ? 'Org Productivity' : 'My Productivity'}
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            {/* Stacked bar takes up 3/5 columns */}
            <div className="xl:col-span-3">
              <ProductivityStackedChart
                from={range.from}
                to={range.to}
                userId={userId}
              />
            </div>
            {/* Donut takes up 2/5 columns */}
            <div className="xl:col-span-2">
              <CategoryDonut
                from={range.from}
                to={range.to}
                userId={userId}
              />
            </div>
          </div>
        </section>

        {/* ── Heatmap Section ─────────────────────────────────────────── */}
        <section aria-labelledby="heatmap-heading">
          <h2
            id="heatmap-heading"
            className="text-base font-semibold text-slate-800 mb-3"
          >
            Activity Heatmap
          </h2>
          <ProductivityHeatmap weeks={8} userId={userId} />
        </section>

        {/* ── Team Overview (managers/admins only) ─────────────────────── */}
        {isManager && (
          <section aria-labelledby="team-overview-heading">
            <h2
              id="team-overview-heading"
              className="text-base font-semibold text-slate-800 mb-3"
            >
              Team Overview
            </h2>
            <TeamProductivityTable from={range.from} to={range.to} />
          </section>
        )}

      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors.

- [ ] **Step 3: Visual spot-check (dev server)**

```bash
cd apps/web && npm run dev &
sleep 8
curl -s http://localhost:3001 | grep -c '<html' || true
```

Open `http://localhost:3001/(dashboard)/analytics` in a browser. Verify:
- Preset buttons render and switch date range
- Stacked bar and donut render side by side on wide screens
- Heatmap grid visible with day-of-week labels on left
- Team table visible for admin/manager accounts (hidden for employee)
- Export CSV button triggers download

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(dashboard\)/analytics/page.tsx
git commit -m "feat(web): replace analytics page with full SP7 dashboard — presets, stacked chart, donut, heatmap, team table"
```

---

## Completion Checklist

Run these after all four tasks are done:

```bash
# Backend tests
cd apps/api && npx jest analytics.service.spec.ts --no-coverage 2>&1 | tail -5

# Backend TypeScript
cd apps/api && npx tsc --noEmit 2>&1 | head -10

# Frontend TypeScript
cd apps/web && npx tsc --noEmit 2>&1 | head -10
```

All three commands must exit clean before marking SP7 complete.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| App categorization by lowercase name match | No DB migration needed; can be extended by editing the `Set` constants |
| `level` thresholds: 0/1h/2h/4h/6h | Matches GitHub heatmap feel; adjusted for work context (6h+ = darkest) |
| Heatmap goes back `weeks` full weeks ending at last Sunday | Ensures the grid always starts on a Sunday (consistent layout) |
| `getOrgProductivitySummary` loads ActivityEvent with `relations: ['user']` | Avoids N+1; single query fetches user names inline |
| ProductivityStackedChart uses `stackId="a"` with productive at bottom, unproductive at top | Green at bottom gives positive-first visual; red on top makes waste visible |
| CategoryDonut center label via recharts `label` prop on `<Pie>` | No extra DOM layer needed; recharts renders SVG `<text>` inside the hole |
| `@ts-expect-error` on CenterLabel usage in PieChart | recharts `label` accepts a ReactElement but TS types are narrow; this is the standard recharts pattern |
| Preset buttons replace raw date inputs as primary UX | Faster for common cases; custom still available |
| SP7 hooks use distinct `queryKey` prefixes | Prevents cache collisions with existing `analytics-productivity` key from `useProductivity` |
