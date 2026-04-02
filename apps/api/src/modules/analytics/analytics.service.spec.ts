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

    it('wraps description in quotes when it contains a comma', async () => {
      timeEntryRepo.find.mockResolvedValue([
        {
          startedAt: new Date('2026-04-02T09:00:00.000Z'),
          endedAt: new Date('2026-04-02T10:00:00.000Z'),
          description: 'fix bug, add feature',
          source: 'manual',
        },
      ]);

      const csv = await service.exportTimeEntriesCSV('u-1', 'org-1', '2026-04-02', '2026-04-02');
      const lines = csv.trim().split('\n');
      expect(lines[1]).toContain('"fix bug, add feature"');
    });
  });
});
