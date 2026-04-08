import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { User, UserRole } from '../../database/entities/user.entity';
import { Project } from '../../database/entities/project.entity';
import { Task } from '../../database/entities/task.entity';
import {
  Timesheet,
} from '../../database/entities/timesheet.entity';
import { Subscription } from '../../database/entities/subscription.entity';

export interface OrgStats {
  totalUsers: number;
  activeUsers: number;
  totalProjects: number;
  totalTasks: number;
  completedTasks: number;
  subscriptionStatus: string | null;
  subscriptionPlan: string | null;
  seatsUsed: number;
  seatsTotal: number;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    @InjectRepository(Timesheet)
    private readonly timesheetRepo: Repository<Timesheet>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  async getOrgStats(organizationId: string): Promise<OrgStats> {
    const [totalUsers, activeUsers, totalProjects, totalTasks, completedTasks, subscription] =
      await Promise.all([
        this.userRepo.count({ where: { organizationId } }),
        this.userRepo.count({ where: { organizationId, isActive: true } }),
        this.projectRepo.count({ where: { organizationId } }),
        this.taskRepo.count({ where: { organizationId } }),
        this.taskRepo.count({ where: { organizationId, status: 'done' as any } }),
        this.subscriptionRepo.findOne({ where: { organizationId } }),
      ]);

    return {
      totalUsers,
      activeUsers,
      totalProjects,
      totalTasks,
      completedTasks,
      subscriptionStatus: subscription?.status ?? null,
      subscriptionPlan: subscription?.plan ?? null,
      seatsUsed: subscription?.quantity ?? activeUsers,
      seatsTotal: subscription?.quantity ?? 0,
    };
  }

  async listUsers(organizationId: string): Promise<Partial<User>[]> {
    return this.userRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
      select: ['id', 'firstName', 'lastName', 'email', 'role', 'isActive', 'createdAt'],
    });
  }

  async exportUsersCSV(organizationId: string): Promise<string> {
    const users = await this.userRepo.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });

    const header = 'id,email,firstName,lastName,role,isActive,createdAt';
    const rows = users.map((u) =>
      [
        u.id,
        u.email,
        this.escapeCsv(u.firstName),
        this.escapeCsv(u.lastName),
        u.role,
        u.isActive,
        u.createdAt.toISOString(),
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  async exportTimesheetCSV(
    organizationId: string,
    from: Date,
    to: Date,
  ): Promise<string> {
    const timesheets = await this.timesheetRepo.find({
      where: {
        organizationId,
        weekStart: Between(
          from.toISOString().slice(0, 10),
          to.toISOString().slice(0, 10),
        ) as any,
      },
      relations: ['user'],
      order: { weekStart: 'ASC' },
    });

    const header =
      'timesheetId,userId,userEmail,weekStart,totalMinutes,totalHours,status,approvedBy,approvedAt';
    const rows = timesheets.map((ts) =>
      [
        ts.id,
        ts.userId,
        (ts as any).user?.email ?? '',
        ts.weekStart,
        ts.totalMinutes,
        (ts.totalMinutes / 60).toFixed(2),
        ts.status,
        ts.approvedBy ?? '',
        ts.approvedAt?.toISOString() ?? '',
      ].join(','),
    );
    return [header, ...rows].join('\n');
  }

  async deactivateUser(
    organizationId: string,
    userId: string,
    actorId: string,
  ): Promise<void> {
    if (userId === actorId) {
      throw new ForbiddenException('You cannot deactivate your own account');
    }
    const user = await this.userRepo.findOne({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.update(userId, { isActive: false });
  }

  async reactivateUser(
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.update(userId, { isActive: true });
  }

  async updateUserRole(
    organizationId: string,
    userId: string,
    role: UserRole,
  ): Promise<void> {
    const user = await this.userRepo.findOne({
      where: { id: userId, organizationId },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.userRepo.update(userId, { role });
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
