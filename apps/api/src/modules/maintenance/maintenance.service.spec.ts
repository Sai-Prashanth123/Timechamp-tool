import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenanceService } from './maintenance.service';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { AgentService } from '../agent/agent.service';

const mockScreenshots: Partial<Screenshot>[] = [
  { id: 'uuid-1', s3Key: 'screenshots/org1/user1/old1.jpg' },
  { id: 'uuid-2', s3Key: 'screenshots/org1/user1/old2.jpg' },
];

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let screenshotRepo: jest.Mocked<Pick<Repository<Screenshot>, 'find' | 'delete'>>;
  let agentService: jest.Mocked<Pick<AgentService, 'deleteS3Object'>>;

  beforeEach(async () => {
    screenshotRepo = {
      find: jest.fn(),
      delete: jest.fn(),
    };

    agentService = {
      deleteS3Object: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        {
          provide: getRepositoryToken(Screenshot),
          useValue: screenshotRepo,
        },
        {
          provide: AgentService,
          useValue: agentService,
        },
      ],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
  });

  describe('cleanupOldScreenshots', () => {
    it('deletes both screenshots from S3 and DB when old records exist', async () => {
      screenshotRepo.find.mockResolvedValue(mockScreenshots as Screenshot[]);
      agentService.deleteS3Object.mockResolvedValue(undefined);
      screenshotRepo.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.cleanupOldScreenshots();

      expect(agentService.deleteS3Object).toHaveBeenCalledTimes(2);
      expect(agentService.deleteS3Object).toHaveBeenCalledWith('screenshots/org1/user1/old1.jpg');
      expect(agentService.deleteS3Object).toHaveBeenCalledWith('screenshots/org1/user1/old2.jpg');

      expect(screenshotRepo.delete).toHaveBeenCalledTimes(2);
      expect(screenshotRepo.delete).toHaveBeenCalledWith('uuid-1');
      expect(screenshotRepo.delete).toHaveBeenCalledWith('uuid-2');
    });

    it('logs "nothing to delete" and skips deletes when find returns empty array', async () => {
      screenshotRepo.find.mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'log');

      await service.cleanupOldScreenshots();

      expect(logSpy).toHaveBeenCalledWith('Screenshot cleanup: nothing to delete');
      expect(agentService.deleteS3Object).not.toHaveBeenCalled();
      expect(screenshotRepo.delete).not.toHaveBeenCalled();
    });

    it('queries with correct cutoff date (90 days ago)', async () => {
      screenshotRepo.find.mockResolvedValue([]);

      const before = new Date();
      before.setDate(before.getDate() - 90);

      await service.cleanupOldScreenshots();

      const findCall = screenshotRepo.find.mock.calls[0][0] as any;
      const cutoffUsed: Date = findCall.where.capturedAt.value;

      // Allow 1 second tolerance
      expect(cutoffUsed.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(cutoffUsed.getTime()).toBeLessThanOrEqual(before.getTime() + 1000);
    });

    it('continues deleting remaining screenshots when one fails', async () => {
      screenshotRepo.find.mockResolvedValue(mockScreenshots as Screenshot[]);
      agentService.deleteS3Object
        .mockRejectedValueOnce(new Error('S3 error'))
        .mockResolvedValueOnce(undefined);
      screenshotRepo.delete.mockResolvedValue({ affected: 1, raw: [] });

      await expect(service.cleanupOldScreenshots()).resolves.not.toThrow();

      // Only the second one succeeded
      expect(screenshotRepo.delete).toHaveBeenCalledTimes(1);
      expect(screenshotRepo.delete).toHaveBeenCalledWith('uuid-2');
    });
  });
});
