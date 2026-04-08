import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogService } from './audit-log.service';
import { AuditLog } from '../../database/entities/audit-log.entity';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repo: jest.Mocked<Repository<AuditLog>>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: getRepositoryToken(AuditLog), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(AuditLogService);
    repo = module.get(getRepositoryToken(AuditLog));
  });

  describe('log()', () => {
    it('creates and saves an audit log entry', async () => {
      const entry = { id: 'uuid-1' } as AuditLog;
      repo.create.mockReturnValue(entry);
      repo.save.mockResolvedValue(entry);

      await service.log(
        'org-1',
        { id: 'actor-1', email: 'admin@acme.com' },
        'user.invited',
        'user',
        'user-99',
        { invitedEmail: 'new@acme.com' },
        '192.168.1.1',
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'actor-1',
          actorEmail: 'admin@acme.com',
          action: 'user.invited',
          resourceType: 'user',
          resourceId: 'user-99',
          metadata: { invitedEmail: 'new@acme.com' },
          ipAddress: '192.168.1.1',
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(entry);
    });

    it('handles optional fields gracefully', async () => {
      const entry = {} as AuditLog;
      repo.create.mockReturnValue(entry);
      repo.save.mockResolvedValue(entry);

      await service.log('org-1', { id: null, email: 'system' }, 'system.event', 'org');

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: null,
          resourceId: null,
          metadata: null,
          ipAddress: null,
        }),
      );
    });
  });

  describe('getLogs()', () => {
    it('builds query with organizationId filter', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getLogs('org-1', {});

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('al');
      expect(qb.where).toHaveBeenCalledWith('al.organizationId = :orgId', { orgId: 'org-1' });
      expect(result).toEqual({ logs: [], total: 0 });
    });

    it('applies actorId filter when provided', async () => {
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.getLogs('org-1', { actorId: 'actor-99' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'al.actorId = :actorId',
        { actorId: 'actor-99' },
      );
    });
  });
});
