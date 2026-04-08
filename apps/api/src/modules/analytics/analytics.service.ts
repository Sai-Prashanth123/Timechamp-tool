import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';
import { RedisService } from '../../infrastructure/redis/redis.service';

// ── App categorization sets ────────────────────────────────────────────────────
const PRODUCTIVE_APPS = new Set([
  'code', 'vscode', 'code.exe', 'webstorm', 'intellij', 'pycharm', 'goland',
  'sublime', 'vim', 'neovim', 'emacs', 'terminal', 'iterm', 'hyper',
  'figma', 'sketch', 'xd', 'photoshop', 'illustrator',
  'chrome', 'firefox', 'safari', 'edge',
  'slack', 'teams', 'zoom', 'meet', 'discord',
  'excel', 'sheets', 'word', 'docs', 'powerpoint', 'notion', 'obsidian',
  'jira', 'linear', 'asana', 'trello', 'github', 'gitlab',
  'postman', 'insomnia', 'docker', 'kubectl',
]);

const UNPRODUCTIVE_APPS = new Set([
  'youtube', 'netflix', 'hulu', 'disney', 'twitch', 'tiktok',
  'facebook', 'instagram', 'twitter', 'reddit', 'snapchat',
  'steam', 'epic games', 'battle.net', 'minecraft',
  'spotify', 'vlc', 'itunes',
  'solitaire', 'minesweeper',
]);

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
    private redis: RedisService,
  ) {}

  async getProductivity(
    userId: string | undefined,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<DailyProductivity[]> {
    const today = new Date().toISOString().slice(0, 10);
    const isPast = to < today;
    const ttl = isPast ? 86400 : 300;
    const cacheKey = `productivity:${organizationId}:${from}:${to}:${userId ?? 'all'}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as DailyProductivity[];

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

    const result = dates.map((date) => {
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

    await this.redis.set(cacheKey, JSON.stringify(result), ttl);
    return result;
  }

  async getAppUsage(
    userId: string | undefined,
    organizationId: string,
    from: string,
    to: string,
  ): Promise<AppUsageRow[]> {
    const today = new Date().toISOString().slice(0, 10);
    const isPast = to < today;
    const ttl = isPast ? 86400 : 300;
    const cacheKey = `appusage:${organizationId}:${from}:${to}:${userId ?? 'all'}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as AppUsageRow[];

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

    const result = [...totals.entries()]
      .map(([appName, sec]) => ({
        appName,
        totalMins: Math.round(sec / 60),
        percentage: Math.round((sec / totalSec) * 100),
      }))
      .sort((a, b) => b.totalMins - a.totalMins);

    await this.redis.set(cacheKey, JSON.stringify(result), ttl);
    return result;
  }

  // ── SP7 new methods ──────────────────────────────────────────────────────────

  categorizeApp(appName: string): 'productive' | 'unproductive' | 'neutral' {
    const lower = appName.toLowerCase().replace('.exe', '').replace('.app', '').trim();
    if (PRODUCTIVE_APPS.has(lower)) return 'productive';
    if (UNPRODUCTIVE_APPS.has(lower)) return 'unproductive';
    return 'neutral';
  }

  async getProductivityReport(
    organizationId: string,
    userId: string | undefined,
    from: string,
    to: string,
  ): Promise<Array<{
    date: string;
    productiveMinutes: number;
    unproductiveMinutes: number;
    neutralMinutes: number;
    totalMinutes: number;
    topApps: Array<{ appName: string; minutes: number; category: string }>;
  }>> {
    const cacheKey = `analytics:report:${organizationId}:${userId ?? 'all'}:${from}:${to}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const where: any = { organizationId };
    if (userId) where.userId = userId;

    const activities = await this.activityRepo.find({ where }).catch(() => [] as ActivityEvent[]);

    // Group by date
    const byDate = new Map<string, {
      productive: number;
      unproductive: number;
      neutral: number;
      apps: Map<string, { minutes: number; category: string }>;
    }>();

    for (const act of activities) {
      const dateStr = act.startedAt?.toISOString?.()?.slice(0, 10) ?? from;
      const durationMinutes = Math.round((act.durationSec ?? 0) / 60);
      const category = this.categorizeApp(act.appName ?? '');

      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, { productive: 0, unproductive: 0, neutral: 0, apps: new Map() });
      }
      const day = byDate.get(dateStr)!;
      if (category === 'productive') day.productive += durationMinutes;
      else if (category === 'unproductive') day.unproductive += durationMinutes;
      else day.neutral += durationMinutes;

      const existing = day.apps.get(act.appName) ?? { minutes: 0, category };
      existing.minutes += durationMinutes;
      day.apps.set(act.appName, existing);
    }

    const result = Array.from(byDate.entries())
      .map(([date, day]) => ({
        date,
        productiveMinutes: day.productive,
        unproductiveMinutes: day.unproductive,
        neutralMinutes: day.neutral,
        totalMinutes: day.productive + day.unproductive + day.neutral,
        topApps: Array.from(day.apps.entries())
          .sort((a, b) => b[1].minutes - a[1].minutes)
          .slice(0, 5)
          .map(([appName, data]) => ({ appName, ...data })),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    await this.redis.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async getOrgProductivitySummary(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<Array<{
    userId: string;
    firstName: string;
    lastName: string;
    productivePercent: number;
    totalHours: number;
    topApp: string;
  }>> {
    const activities = await this.activityRepo.find({
      where: { organizationId },
      relations: ['user'],
    }).catch(() => [] as ActivityEvent[]);

    const byUser = new Map<string, {
      productive: number;
      total: number;
      topApps: Map<string, number>;
      user: any;
    }>();

    for (const act of activities) {
      const uid = act.userId;
      const mins = Math.round((act.durationSec ?? 0) / 60);
      const cat = this.categorizeApp(act.appName ?? '');

      if (!byUser.has(uid)) {
        byUser.set(uid, { productive: 0, total: 0, topApps: new Map(), user: act.user });
      }
      const entry = byUser.get(uid)!;
      entry.total += mins;
      if (cat === 'productive') entry.productive += mins;
      entry.topApps.set(act.appName, (entry.topApps.get(act.appName) ?? 0) + mins);
    }

    return Array.from(byUser.entries()).map(([userId, data]) => {
      const topApp = Array.from(data.topApps.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A';
      return {
        userId,
        firstName: data.user?.firstName ?? '',
        lastName: data.user?.lastName ?? '',
        productivePercent: data.total > 0 ? Math.round((data.productive / data.total) * 100) : 0,
        totalHours: Math.round((data.total / 60) * 10) / 10,
        topApp,
      };
    });
  }

  async getProductivityHeatmap(
    organizationId: string,
    userId?: string,
    weeks = 8,
  ): Promise<Array<{ date: string; productiveMinutes: number; level: 0 | 1 | 2 | 3 | 4 }>> {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - weeks * 7);

    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const report = await this.getProductivityReport(organizationId, userId, fromStr, toStr);

    const days: Array<{ date: string; productiveMinutes: number; level: 0 | 1 | 2 | 3 | 4 }> = [];
    const current = new Date(from);
    const reportMap = new Map(report.map((r) => [r.date, r.productiveMinutes]));

    while (current <= to) {
      const dateStr = current.toISOString().slice(0, 10);
      const mins = reportMap.get(dateStr) ?? 0;
      const level: 0 | 1 | 2 | 3 | 4 = mins === 0 ? 0 : mins < 60 ? 1 : mins < 120 ? 2 : mins < 240 ? 3 : 4;
      days.push({ date: dateStr, productiveMinutes: mins, level });
      current.setDate(current.getDate() + 1);
    }

    return days;
  }

  /** RFC 4180 CSV field escaping */
  private csvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
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
      const desc = this.csvField(e.description ?? '');
      return `${date},${start},${end},${durationMins},${desc},${e.source}`;
    });

    return [header, ...rows].join('\n');
  }
}
