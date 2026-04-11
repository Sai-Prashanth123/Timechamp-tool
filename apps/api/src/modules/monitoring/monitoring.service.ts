import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan, LessThan } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { AgentService } from '../agent/agent.service';
import { MonitoringGateway } from './monitoring.gateway';
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

// Offline threshold: 3× the 30s heartbeat interval. Tolerates one missed
// packet + one late retry without flapping, while still marking a dead
// agent grey within ~60s of it stopping.
const OFFLINE_THRESHOLD_MS = 90 * 1000;

export type ScreenshotWithUrl = {
  id: string;
  userId: string;
  capturedAt: Date;
  fileSizeBytes: number;
  url: string;
};

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  // Tracks which user IDs we've already emitted an 'offline' event for in the
  // current stale window, so the sweep doesn't spam the same event every 30s.
  // Cleared for a user as soon as they come back online (heartbeat updates
  // lastSeenAt and they drop out of the LessThan query).
  private readonly offlineEmitted = new Set<string>();

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
    private monitoringGateway: MonitoringGateway,
    private redis: RedisService,
  ) {}

  /**
   * Offline sweep — runs every 30s (matches the agent heartbeat cadence).
   * Finds every active device whose lastSeenAt is older than the offline
   * threshold and emits a one-shot `employee:status { offline }` event to
   * the org room. Does NOT flip isActive in the DB — offline is a derived
   * UX signal, not a persistent state, and the device may reconnect any
   * moment.
   *
   * Deduplication: uses an in-memory Set so we don't re-emit every 30s for
   * the same stale device. The entry is auto-cleared when the device comes
   * back online (it leaves the LessThan window).
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepOfflineAgents(): Promise<void> {
    const threshold = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const stale = await this.deviceRepo.find({
      where: { isActive: true, lastSeenAt: LessThan(threshold) },
      select: ['userId', 'organizationId', 'lastSeenAt'],
    });

    const stillStale = new Set<string>();
    for (const device of stale) {
      stillStale.add(device.userId);
      if (this.offlineEmitted.has(device.userId)) continue;
      this.offlineEmitted.add(device.userId);
      this.monitoringGateway.emitEmployeeStatus(device.organizationId, {
        userId: device.userId,
        status: 'offline',
        lastSeen: device.lastSeenAt ?? new Date(0),
      });
      this.logger.debug(`Marked user ${device.userId} offline (stale heartbeat)`);
    }
    // Drop cache entries for users who are no longer stale (they reconnected).
    for (const userId of this.offlineEmitted) {
      if (!stillStale.has(userId)) this.offlineEmitted.delete(userId);
    }
  }

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
