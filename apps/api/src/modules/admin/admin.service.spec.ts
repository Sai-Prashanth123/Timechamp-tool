import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { User, UserRole } from '../../database/entities/user.entity';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import { Timesheet } from '../../database/entities/timesheet.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

const mockRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('AdminService', () => {
  let service: AdminService;
  let userRepo: any;
  let projectRepo: any;
  let taskRepo: any;
  let timesheetRepo: any;
  let subscriptionRepo: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useFactory: mockRepo },
        { provide: getRepositoryToken(Project), useFactory: mockRepo },
        { provide: getRepositoryToken(Task), useFactory: mockRepo },
        { provide: getRepositoryToken(Timesheet), useFactory: mockRepo },
        { provide: getRepositoryToken(Subscription), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(AdminService);
    userRepo = module.get(getRepositoryToken(User));
    projectRepo = module.get(getRepositoryToken(Project));
    taskRepo = module.get(getRepositoryToken(Task));
    timesheetRepo = module.get(getRepositoryToken(Timesheet));
    subscriptionRepo = module.get(getRepositoryToken(Subscription));
  });

  describe('getOrgStats()', () => {
    it('returns aggregated stats for the organization', async () => {
      userRepo.count
        .mockResolvedValueOnce(10)   // totalUsers
        .mockResolvedValueOnce(8);   // activeUsers
      projectRepo.count.mockResolvedValue(5);
      taskRepo.count
        .mockResolvedValueOnce(30)   // totalTasks
        .mockResolvedValueOnce(12);  // completedTasks
      subscriptionRepo.findOne.mockResolvedValue({
        status: 'active',
        plan: 'pro',
        quantity: 10,
      });

      const stats = await service.getOrgStats('org-1');

      expect(stats.totalUsers).toBe(10);
      expect(stats.activeUsers).toBe(8);
      expect(stats.totalProjects).toBe(5);
      expect(stats.totalTasks).toBe(30);
      expect(stats.completedTasks).toBe(12);
      expect(stats.subscriptionStatus).toBe('active');
      expect(stats.seatsUsed).toBe(10);
    });
  });

  describe('deactivateUser()', () => {
    it('sets isActive=false for a non-admin user', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        organizationId: 'org-1',
        role: UserRole.EMPLOYEE,
        isActive: true,
      });
      userRepo.update.mockResolvedValue({});

      await service.deactivateUser('org-1', 'u1', 'actor-id');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { isActive: false });
    });

    it('throws ForbiddenException when trying to deactivate self', async () => {
      await expect(
        service.deactivateUser('org-1', 'actor-id', 'actor-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.deactivateUser('org-1', 'u-missing', 'actor-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reactivateUser()', () => {
    it('sets isActive=true', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        organizationId: 'org-1',
        isActive: false,
      });
      userRepo.update.mockResolvedValue({});

      await service.reactivateUser('org-1', 'u1');

      expect(userRepo.update).toHaveBeenCalledWith('u1', { isActive: true });
    });
  });

  describe('updateUserRole()', () => {
    it('updates the role', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        organizationId: 'org-1',
        role: UserRole.EMPLOYEE,
      });
      userRepo.update.mockResolvedValue({});

      await service.updateUserRole('org-1', 'u1', UserRole.MANAGER);

      expect(userRepo.update).toHaveBeenCalledWith('u1', { role: UserRole.MANAGER });
    });

    it('throws NotFoundException when user not in org', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateUserRole('org-1', 'bad-id', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('exportUsersCSV()', () => {
    it('returns CSV string with headers and user rows', async () => {
      userRepo.find.mockResolvedValue([
        {
          id: 'u1',
          email: 'alice@acme.com',
          firstName: 'Alice',
          lastName: 'Smith',
          role: 'admin',
          isActive: true,
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const csv = await service.exportUsersCSV('org-1');

      expect(csv).toContain('id,email,firstName,lastName,role,isActive,createdAt');
      expect(csv).toContain('alice@acme.com');
      expect(csv).toContain('admin');
    });
  });
});
