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

/**
 * One row per live agent device — NOT per user. A single user can own
 * multiple machines and each appears as its own card on the dashboard.
 * Legacy callers that still want the old employee-centric shape should
 * group this by userId on the client.
 */
export type LiveDevice = {
  deviceId: string;
  userId: string;
  userName: string;
  displayName: string | null;  // user-entered label ("Sai's Laptop")
  hostname: string | null;      // fallback when displayName is null
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
      select: ['id', 'userId', 'organizationId', 'lastSeenAt'],
    });

    // Dedupe by deviceId, not userId, so two stale machines owned by the
    // same user each get their own offline event.
    const stillStale = new Set<string>();
    for (const device of stale) {
      stillStale.add(device.id);
      if (this.offlineEmitted.has(device.id)) continue;
      this.offlineEmitted.add(device.id);
      this.monitoringGateway.emitEmployeeStatus(device.organizationId, {
        userId: device.userId,
        deviceId: device.id,
        status: 'offline',
        lastSeen: device.lastSeenAt ?? new Date(0),
      });
      this.logger.debug(`Marked device ${device.id} (user ${device.userId}) offline (stale heartbeat)`);
    }
    // Drop cache entries for devices that have since reconnected (they
    // left the LessThan window).
    for (const deviceId of this.offlineEmitted) {
      if (!stillStale.has(deviceId)) this.offlineEmitted.delete(deviceId);
    }
  }

  async getActivity(
    userId: string | undefined,
    organizationId: string,
    query: { from?: string; to?: string; deviceId?: string },
  ): Promise<ActivityEvent[]> {
    const where: any = { organizationId };
    if (userId) where.userId = userId;
    // deviceId filter — a user with multiple machines sees one device's
    // activity at a time instead of all devices mixed into one timeline.
    if (query.deviceId) where.deviceId = query.deviceId;
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
    query: { from?: string; to?: string; deviceId?: string },
  ): Promise<ScreenshotWithUrl[]> {
    const where: any = { organizationId };
    if (userId) where.userId = userId;
    // deviceId filter used by the /live per-device Watch Live flow so the
    // LiveScreenshotView polling only returns shots from the machine you
    // clicked, not all devices that user owns.
    if (query.deviceId) where.deviceId = query.deviceId;
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

  async getLiveStatus(organizationId: string): Promise<LiveDevice[]> {
    // v2 cache key — the payload shape changed when this flipped from
    // employee-centric (one row per user) to device-centric (one row per
    // agent). Any stale v1 entries are ignored rather than deserialized
    // into the wrong type.
    const cacheKey = `live:v2:${organizationId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as LiveDevice[];

    // Consider any device that sent a heartbeat in the last 5 minutes as "online"
    const since = new Date(Date.now() - ONLINE_WINDOW_MS);
    const activeDevices = await this.deviceRepo.find({
      where: { organizationId, isActive: true, lastSeenAt: MoreThan(since) },
      relations: ['user'],
      order: { lastSeenAt: 'DESC' },
    });

    const result: LiveDevice[] = await Promise.all(
      activeDevices.map(async (device) => {
        // currentApp is filtered by deviceId so two machines owned by the
        // same user show their own apps on their own cards. During the
        // first ~30s after a fresh deploy the activity queue may still
        // be flushing rows with null deviceId — those are ignored by this
        // query and the card briefly shows "Idle" until the next batch.
        const lastActivity = await this.activityRepo.findOne({
          where: { deviceId: device.id, organizationId },
          order: { startedAt: 'DESC' },
        });
        const userName =
          `${device.user?.firstName ?? ''} ${device.user?.lastName ?? ''}`.trim() ||
          (device.user?.email ?? '');
        return {
          deviceId: device.id,
          userId: device.userId,
          userName,
          displayName: device.displayName ?? null,
          hostname: device.hostname ?? null,
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
