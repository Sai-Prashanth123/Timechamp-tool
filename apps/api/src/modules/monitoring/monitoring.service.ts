import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { AgentService } from '../agent/agent.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

export type LiveEmployee = {
  userId: string;
  firstName: string;
  lastName: string;
  clockedInSince: Date;
  currentApp: string | null;
  lastSeenAt: Date | null;
};

// Agent is considered "online" if it sent a heartbeat within this window
const ONLINE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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
    @InjectRepository(AgentDevice)
    private deviceRepo: Repository<AgentDevice>,
    private agentService: AgentService,
    private redis: RedisService,
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
    const cacheKey = `live:${organizationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as LiveEmployee[];

    // Consider any device that sent a heartbeat in the last 5 minutes as "online"
    const since = new Date(Date.now() - ONLINE_WINDOW_MS);
    const activeDevices = await this.deviceRepo.find({
      where: { organizationId, isActive: true, lastSeenAt: MoreThan(since) },
      relations: ['user'],
      order: { lastSeenAt: 'DESC' },
    });

    const result = await Promise.all(
      activeDevices.map(async (device) => {
        const lastActivity = await this.activityRepo.findOne({
          where: { userId: device.userId, organizationId },
          order: { startedAt: 'DESC' },
        });
        return {
          userId: device.userId,
          firstName: device.user?.firstName ?? '',
          lastName: device.user?.lastName ?? '',
          clockedInSince: device.lastSeenAt ?? device.createdAt,
          currentApp: lastActivity?.appName ?? null,
          lastSeenAt: device.lastSeenAt,
        };
      }),
    );

    await this.redis.set(cacheKey, JSON.stringify(result), 30);
    return result;
  }
}
