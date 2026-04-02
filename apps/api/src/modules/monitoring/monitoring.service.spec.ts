import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MonitoringService } from './monitoring.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { User } from '../../database/entities/user.entity';
import { AgentService } from '../agent/agent.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function mockRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('MonitoringService', () => {
  let service: MonitoringService;
  let activityRepo: MockRepo;
  let screenshotRepo: MockRepo;
  let attendanceRepo: MockRepo;
  let agentService: { getPresignedDownloadUrl: jest.Mock };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

  beforeEach(async () => {
    activityRepo = mockRepo();
    screenshotRepo = mockRepo();
    attendanceRepo = mockRepo();
    agentService = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed') };
    redisService = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Screenshot), useValue: screenshotRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: AgentService, useValue: agentService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<MonitoringService>(MonitoringService);
  });

  // ── getActivity ────────────────────────────────────────────────────
  describe('getActivity', () => {
    it('returns activity events for a user', async () => {
      const events: Partial<ActivityEvent>[] = [
        { id: 'evt-1', appName: 'Chrome', durationSec: 300, startedAt: new Date() },
        { id: 'evt-2', appName: 'VSCode', durationSec: 600, startedAt: new Date() },
      ];
      activityRepo.find.mockResolvedValue(events);

      const result = await service.getActivity('u-1', 'org-1', {});

      expect(activityRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u-1', organizationId: 'org-1' }) }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].appName).toBe('Chrome');
    });

    it('returns all org activity when userId is undefined (manager view)', async () => {
      activityRepo.find.mockResolvedValue([]);
      await service.getActivity(undefined, 'org-1', {});
      expect(activityRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
      );
      // userId should NOT be in the where clause
      const callArg = activityRepo.find.mock.calls[0][0];
      expect(callArg.where.userId).toBeUndefined();
    });
  });

  // ── getScreenshots ──────────────────────────────────────────────────
  describe('getScreenshots', () => {
    it('returns screenshots with presigned URLs', async () => {
      const shots: Partial<Screenshot>[] = [
        { id: 'sc-1', s3Key: 'screenshots/org/user/ts.jpg', capturedAt: new Date() },
      ];
      screenshotRepo.find.mockResolvedValue(shots);

      const result = await service.getScreenshots('u-1', 'org-1', {});

      expect(agentService.getPresignedDownloadUrl).toHaveBeenCalledWith('screenshots/org/user/ts.jpg');
      expect(result[0].url).toBe('https://s3.example.com/signed');
    });

    it('returns screenshots for all org when userId is undefined', async () => {
      screenshotRepo.find.mockResolvedValue([]);
      await service.getScreenshots(undefined, 'org-1', {});
      const callArg = screenshotRepo.find.mock.calls[0][0];
      expect(callArg.where.userId).toBeUndefined();
    });
  });

  // ── getLiveStatus ──────────────────────────────────────────────────
  describe('getLiveStatus', () => {
    it('returns live employee records from open attendance', async () => {
      const clockInTime = new Date(Date.now() - 3_600_000);
      const attendances: Partial<Attendance>[] = [
        {
          id: 'att-1',
          userId: 'u-1',
          clockIn: clockInTime,
          clockOut: null,
          user: { firstName: 'Alice', lastName: 'Smith' } as User,
        },
      ];
      attendanceRepo.find.mockResolvedValue(attendances);
      activityRepo.findOne.mockResolvedValue({ appName: 'Chrome', startedAt: new Date() });

      const result = await service.getLiveStatus('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('u-1');
      expect(result[0].currentApp).toBe('Chrome');
    });

    it('returns empty array when no employees are clocked in', async () => {
      attendanceRepo.find.mockResolvedValue([]);
      const result = await service.getLiveStatus('org-1');
      expect(result).toHaveLength(0);
    });
  });
});
