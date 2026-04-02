import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentService } from '../agent/agent.service';

export type LiveEmployee = {
  userId: string;
  firstName: string;
  lastName: string;
  clockedInSince: Date;
  currentApp: string | null;
  lastSeenAt: Date | null;
};

export type ScreenshotWithUrl = {
  id: string;
  userId: string;
  capturedAt: Date;
  fileSizeBytes: number;
  url: string;
};

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(ActivityEvent)
    private activityRepo: Repository<ActivityEvent>,
    @InjectRepository(Screenshot)
    private screenshotRepo: Repository<Screenshot>,
    @InjectRepository(Attendance)
    private attendanceRepo: Repository<Attendance>,
    private agentService: AgentService,
  ) {}

  async getActivity(
    userId: string | undefined,
    organizationId: string,
    query: { from?: string; to?: string },
  ): Promise<ActivityEvent[]> {
    const where: any = { organizationId };
    if (userId) where.userId = userId;
    if (query.from && query.to) {
      where.startedAt = Between(new Date(query.from), new Date(query.to));
    }
    return this.activityRepo.find({
      where,
      order: { startedAt: 'DESC' },
      take: 500,
    });
  }

  async getScreenshots(
    userId: string | undefined,
    organizationId: string,
    query: { from?: string; to?: string },
  ): Promise<ScreenshotWithUrl[]> {
    const where: any = { organizationId };
    if (userId) where.userId = userId;
    if (query.from && query.to) {
      where.capturedAt = Between(new Date(query.from), new Date(query.to));
    }
    const shots = await this.screenshotRepo.find({
      where,
      order: { capturedAt: 'DESC' },
      take: 100,
    });

    return Promise.all(
      shots.map(async (s) => ({
        id: s.id,
        userId: s.userId,
        capturedAt: s.capturedAt,
        fileSizeBytes: s.fileSizeBytes,
        url: await this.agentService.getPresignedDownloadUrl(s.s3Key),
      })),
    );
  }

  async getLiveStatus(organizationId: string): Promise<LiveEmployee[]> {
    const openAttendances = await this.attendanceRepo.find({
      where: { organizationId, clockOut: null as any },
      relations: ['user'],
      order: { clockIn: 'ASC' },
    });

    return Promise.all(
      openAttendances.map(async (att) => {
        const lastActivity = await this.activityRepo.findOne({
          where: { userId: att.userId, organizationId },
          order: { startedAt: 'DESC' },
        });
        return {
          userId: att.userId,
          firstName: att.user?.firstName ?? '',
          lastName: att.user?.lastName ?? '',
          clockedInSince: att.clockIn,
          currentApp: lastActivity?.appName ?? null,
          lastSeenAt: lastActivity?.startedAt ?? null,
        };
      }),
    );
  }
}
