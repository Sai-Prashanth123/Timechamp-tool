import { Injectable, ServiceUnavailableException, UnauthorizedException, Logger, forwardRef, Inject, Optional, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { User } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { AgentMetric } from '../../database/entities/agent-metric.entity';
import { KeystrokeEvent } from '../../database/entities/keystroke-event.entity';
import { AgentTelemetry } from '../../database/entities/agent-telemetry.entity';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncMetricsDto } from './dto/sync-metrics.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';
import { SyncGpsDto } from './dto/sync-gps.dto';
import { SyncKeystrokesDto } from './dto/sync-keystrokes.dto';
import { SyncTelemetryDto } from './dto/sync-telemetry.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { HeartbeatBufferService } from './heartbeat-buffer.service';
import { ActivityQueueService } from './activity-queue.service';
import { MetricsQueueService } from './metrics-queue.service';
import { KeystrokesQueueService } from './keystrokes-queue.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { CrashReportDto } from './dto/crash-report.dto';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
import { TokenService } from '../../infrastructure/token/token.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AgentService implements OnModuleInit {
  private readonly logger = new Logger(AgentService.name);
  private s3: S3Client | null = null;
  private bucket: string | null = null;
  private cdnUrl: string | null = null;
  private supabase: SupabaseClient | null = null;
  private readonly SCREENSHOTS_BUCKET = 'screenshots';

  constructor(
    private config: ConfigService,
    @InjectRepository(ActivityEvent)
    private activityRepo: Repository<ActivityEvent>,
    @InjectRepository(Screenshot)
    private screenshotRepo: Repository<Screenshot>,
    @InjectRepository(GpsLocation)
    private gpsLocationRepo: Repository<GpsLocation>,
    @InjectRepository(Organization)
    private orgRepo: Repository<Organization>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AgentDevice)
    private deviceRepo: Repository<AgentDevice>,
    @InjectRepository(AgentMetric)
    private metricsRepo: Repository<AgentMetric>,
    @InjectRepository(KeystrokeEvent)
    private keystrokeRepo: Repository<KeystrokeEvent>,
    @InjectRepository(AgentTelemetry)
    private telemetryRepo: Repository<AgentTelemetry>,
    private heartbeatBuffer: HeartbeatBufferService,
    private activityQueue: ActivityQueueService,
    private metricsQueue: MetricsQueueService,
    private keystrokesQueue: KeystrokesQueueService,
    private tokenService: TokenService,
    private usersService: UsersService,
    @Optional() @Inject(forwardRef(() => MonitoringGateway))
    private monitoringGateway: MonitoringGateway | undefined,
  ) {
    // Determine storage provider from env vars
    const b2Bucket = this.config.get<string>('B2_BUCKET');
    const s3Bucket = this.config.get<string>('S3_BUCKET');

    if (b2Bucket) {
      // Backblaze B2 via S3-compatible API
      this.s3 = new S3Client({
        endpoint: this.config.get<string>('B2_ENDPOINT'),
        region: 'auto',
        credentials: {
          accessKeyId: this.config.get<string>('B2_KEY_ID')!,
          secretAccessKey: this.config.get<string>('B2_APP_KEY')!,
        },
        forcePathStyle: false,
      });
      this.bucket = b2Bucket;
      this.cdnUrl = this.config.get<string>('B2_CDN_URL') || null;
    } else if (s3Bucket) {
      // Existing S3/R2 logic
      const region = this.config.get<string>('AWS_REGION', 'us-east-1');
      const endpoint = this.config.get<string>('S3_ENDPOINT'); // R2: https://<account-id>.r2.cloudflarestorage.com
      this.bucket = s3Bucket;
      this.s3 = new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: false } : {}),
      });
    }

    // Supabase Storage — takes priority when configured
    const supabaseUrl = this.config.get<string>('SUPABASE_URL');
    const supabaseServiceKey = this.config.get<string>('SUPABASE_SERVICE_KEY');
    if (supabaseUrl && supabaseServiceKey) {
      this.supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
      });
    }
  }

  async onModuleInit() {
    if (!this.supabase) return;
    // Ensure the screenshots bucket exists — wrapped so a Supabase error never crashes the service
    try {
      const { data: buckets } = await this.supabase.storage.listBuckets();
      const exists = buckets?.some((b) => b.name === this.SCREENSHOTS_BUCKET);
      if (!exists) {
        const { error } = await this.supabase.storage.createBucket(this.SCREENSHOTS_BUCKET, {
          public: false,
          fileSizeLimit: 10 * 1024 * 1024,
        });
        if (error) {
          this.logger.error(`Failed to create storage bucket: ${error.message}`);
        } else {
          this.logger.log(`Created Supabase Storage bucket: ${this.SCREENSHOTS_BUCKET}`);
        }
      } else {
        this.logger.log(`Supabase Storage bucket ready: ${this.SCREENSHOTS_BUCKET}`);
      }
    } catch (err) {
      this.logger.error(`Supabase Storage init failed (non-fatal): ${err}`);
    }
  }

  async saveActivities(
    user: User,
    dto: SyncActivityDto,
    deviceId?: string,
  ): Promise<number> {
    if (dto.events.length === 0) return 0;

    // Enqueue the entire batch to pgmq instead of inserting synchronously.
    // The agent's HTTP request returns in <50ms regardless of how slow the
    // real activity_events table is. ActivityWorkerService drains the queue
    // every 2s and bulk-inserts in the background.
    //
    // The agent's "Synced: N activity ..." log line shows the count of
    // events ENQUEUED, not the count actually flushed to Postgres — that
    // happens shortly after, off the request hot path.
    //
    // `deviceId` is top-level on the payload so downstream filtering
    // (getLiveStatus currentApp, future per-device reports) can pivot
    // without re-joining to agent_devices on every read.
    await this.activityQueue.enqueue({
      userId: user.id,
      organizationId: user.organizationId,
      deviceId: deviceId ?? null,
      events: dto.events.map((e) => ({
        appName: e.appName,
        windowTitle: e.windowTitle ?? null,
        startedAt: typeof e.startedAt === 'string' ? e.startedAt : new Date(e.startedAt).toISOString(),
        durationSec: e.durationSec,
        durationMs: e.durationMs,
        keystrokeCount: e.keystrokeCount,
      })),
    });

    // Live monitoring still gets the latest event inline so the dashboard
    // grid flips immediately — this is in-memory + WebSocket only, no DB
    // round-trip on the hot path. Only the persistent insert is deferred.
    // `deviceId` is forwarded when present so device-centric subscribers
    // can route the update to the exact card instead of broadcasting.
    const latest = dto.events[dto.events.length - 1];
    this.monitoringGateway?.emitActivityUpdate(user.organizationId, {
      userId: user.id,
      deviceId,
      appName: latest.appName,
      windowTitle: latest.windowTitle ?? null,
      timestamp: typeof latest.startedAt === 'string' ? new Date(latest.startedAt) : latest.startedAt,
    });

    return dto.events.length;
  }

  async generateUploadUrl(user: User): Promise<{ uploadUrl: string; screenshotKey: string }> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotKey = `${user.organizationId}/${user.id}/${ts}.jpg`;

    // Supabase Storage (preferred)
    if (this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.SCREENSHOTS_BUCKET)
        .createSignedUploadUrl(screenshotKey);
      if (error) throw new ServiceUnavailableException(`Supabase Storage error: ${error.message}`);
      if (!data?.signedUrl) throw new ServiceUnavailableException('Supabase Storage returned empty upload URL');
      return { uploadUrl: data.signedUrl, screenshotKey };
    }

    // S3 / B2 fallback
    if (this.s3 && this.bucket) {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: `screenshots/${screenshotKey}`,
        ContentType: 'image/jpeg',
      });
      const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 });
      return { uploadUrl, screenshotKey: `screenshots/${screenshotKey}` };
    }

    throw new ServiceUnavailableException(
      'Screenshot storage is not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)',
    );
  }

  async saveScreenshot(
    user: User,
    dto: SyncScreenshotDto,
    deviceId?: string,
  ): Promise<Screenshot> {
    const entity = this.screenshotRepo.create({
      userId: user.id,
      organizationId: user.organizationId,
      deviceId: deviceId ?? null,
      s3Key: dto.screenshotKey,
      capturedAt: new Date(dto.capturedAt),
      fileSizeBytes: dto.fileSizeBytes,
    });
    const saved = await this.screenshotRepo.save(entity);

    // Presign the download URL and ship it inline with the WS emit so the
    // live-view browser can render the frame immediately — no follow-up
    // /monitoring/screenshots REST call needed. Failure to presign is
    // non-fatal: we emit url='' and the browser's fallback HTTP poll
    // (every ~2s) will pick up the frame via getPresignedDownloadUrl.
    let url = '';
    try {
      url = await this.getPresignedDownloadUrl(dto.screenshotKey);
    } catch (err) {
      this.logger.warn(
        `Presign for WS emit failed (screenshot=${saved.id}): ${(err as Error).message}`,
      );
    }

    this.monitoringGateway?.emitScreenshotTaken(user.organizationId, {
      userId: user.id,
      deviceId,
      screenshotId: saved.id,
      capturedAt: saved.capturedAt,
      url,
    });
    return saved;
  }

  async getPresignedDownloadUrl(s3Key: string): Promise<string> {
    // Supabase Storage
    if (this.supabase) {
      const { data, error } = await this.supabase.storage
        .from(this.SCREENSHOTS_BUCKET)
        .createSignedUrl(s3Key, 3600);
      if (error) return '';
      return data.signedUrl;
    }

    if (!this.s3 || !this.bucket) return '';
    // If CDN URL is configured (B2 + Cloudflare CDN), serve directly — zero egress cost
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${s3Key}`;
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }

  async saveGpsLocations(user: User, dto: SyncGpsDto): Promise<number> {
    const entities = dto.points.map((p) =>
      this.gpsLocationRepo.create({
        userId: user.id,
        organizationId: user.organizationId,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy ?? null,
        batteryLevel: p.batteryLevel ?? null,
        recordedAt: new Date(p.recordedAt),
      }),
    );
    await this.gpsLocationRepo.save(entities);
    return entities.length;
  }

  async getOrgConfig(organizationId: string): Promise<{
    screenshotIntervalSec: number;
    streamingEnabled: boolean;
    cameraEnabled: boolean;
    audioEnabled: boolean;
    maxStreamFps: number;
  }> {
    const org = await this.orgRepo.findOne({
      where: { id: organizationId },
      select: ['id', 'screenshotIntervalSec', 'streamingEnabled', 'cameraEnabled', 'audioEnabled', 'maxStreamFps'],
    });
    return {
      screenshotIntervalSec: org?.screenshotIntervalSec ?? 300,
      streamingEnabled: org?.streamingEnabled ?? false,
      cameraEnabled: org?.cameraEnabled ?? false,
      audioEnabled: org?.audioEnabled ?? false,
      maxStreamFps: org?.maxStreamFps ?? 1,
    };
  }

  async deleteS3Object(key: string): Promise<void> {
    if (!this.s3 || !this.bucket) return;
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async registerAgent(dto: RegisterAgentDto): Promise<{
    agentToken: string;
    employeeId: string;
    orgId: string;
  }> {
    // Exactly one of the two token paths must be provided.
    if (!dto.personalToken && !dto.inviteToken) {
      throw new UnauthorizedException('Missing personalToken or inviteToken');
    }
    if (dto.personalToken && dto.inviteToken) {
      throw new UnauthorizedException('Provide only one of personalToken or inviteToken');
    }

    // ── Resolve user ─────────────────────────────────────────────────────
    let user: User | null = null;

    if (dto.personalToken) {
      // New flow: look up by users.agent_token. This column is declared
      // `select: false` on the entity, so we must list it explicitly.
      this.logger.log(`Register attempt (personal): token="${dto.personalToken.slice(0, 8)}..."`);
      user = await this.userRepo.findOne({
        where: { agentToken: dto.personalToken },
        select: ['id', 'organizationId', 'isActive'],
      });
      if (!user) {
        throw new UnauthorizedException('Invalid personal agent token');
      }
    } else {
      // Legacy flow: consume one-time invite token.
      this.logger.log(`Register attempt (invite): token="${dto.inviteToken!.slice(0, 8)}..." len=${dto.inviteToken!.length}`);
      const userId = await this.tokenService.consume('invite', dto.inviteToken!);
      this.logger.log(`Token consume result: userId="${userId}"`);
      if (!userId) {
        throw new UnauthorizedException('Invalid or expired invite token');
      }
      user = await this.userRepo.findOne({ where: { id: userId } });
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // ── Create device row ───────────────────────────────────────────────
    // displayName fallback chain: user-entered name > hostname > null.
    // Older agents that don't know about the field will just leave it
    // null and the dashboard falls back to hostname at render time.
    const deviceToken = randomUUID();
    const device = this.deviceRepo.create({
      organizationId: user.organizationId,
      userId: user.id,
      deviceToken,
      displayName: dto.displayName?.trim() || dto.hostname || null,
      hostname: dto.hostname ?? null,
      platform: dto.os ?? null,
      agentVersion: dto.agentVersion ?? null,
      lastSeenAt: new Date(),
    });
    await this.deviceRepo.save(device);

    // ── Burn the personal token ─────────────────────────────────────────
    // Each successful registration consumes one personal token, so the
    // next device has to fetch a fresh one from /settings/agent. This is
    // fire-and-forget from the agent's perspective: the agent already
    // holds its per-device `deviceToken` (returned below) and doesn't
    // care that the personal token changed underneath it. Already-
    // registered devices are unaffected for the same reason.
    //
    // The rotate is best-effort: if it throws, we still return success
    // for this registration — the user can rotate manually from the UI
    // if something went wrong. A rotate failure should never fail a
    // working device register.
    try {
      await this.usersService.rotateAgentToken(user.id);
    } catch (err) {
      this.logger.warn(
        `Auto-rotate after register failed for user=${user.id}: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `Agent registered: user=${user.id} org=${user.organizationId} ` +
      `host=${dto.hostname} displayName="${device.displayName}"`,
    );
    return { agentToken: deviceToken, employeeId: user.id, orgId: user.organizationId };
  }

  async recordHeartbeat(
    user: User,
    dto: HeartbeatDto = {},
    deviceId?: string,
  ): Promise<void> {
    const now = new Date();
    // Round 5 / R5.3: write-behind via HeartbeatBufferService. This replaces
    // a per-request UPDATE (1,667 QPS at 100K agents) with one bulk UPDATE
    // every 5 seconds. The WebSocket emit stays inline so live-view presence
    // still flips instantly.
    //
    // The buffer keys by deviceId so each machine has its own last_seen_at
    // timer (see HeartbeatBufferService docstring). The third arg is only
    // carried for logging/debugging.
    this.heartbeatBuffer.record(deviceId, now, user.id);
    this.monitoringGateway?.emitEmployeeStatus(user.organizationId, {
      userId: user.id,
      deviceId,
      status: dto.idle ? 'idle' : 'online',
      lastSeen: now,
    });
  }

  async findDeviceByToken(token: string): Promise<AgentDevice | null> {
    return this.deviceRepo.findOne({ where: { deviceToken: token, isActive: true } });
  }

  async saveMetrics(user: User, dto: SyncMetricsDto): Promise<void> {
    if (dto.events.length === 0) return;
    // Enqueue instead of synchronous insert. Identity comes from the auth
    // guard's user object, not the DTO body — preserves the IDOR fix from
    // Round 5 / R5.2. MetricsWorkerService drains every 5 seconds.
    await this.metricsQueue.enqueue({
      userId: user.id,
      organizationId: user.organizationId,
      events: dto.events.map((e) => ({
        cpuPercent: e.cpuPercent,
        memUsedMb: e.memUsedMb,
        memTotalMb: e.memTotalMb,
        agentCpuPercent: e.agentCpuPercent,
        agentMemMb: e.agentMemMb,
        recordedAt: typeof e.recordedAt === 'string' ? e.recordedAt : new Date(e.recordedAt).toISOString(),
      })),
    });
  }

  async saveKeystrokes(user: User, dto: SyncKeystrokesDto): Promise<number> {
    if (dto.events.length === 0) return 0;
    // Enqueue instead of synchronous insert. Same rationale as saveActivities.
    // KeystrokesWorkerService drains every 5 seconds.
    await this.keystrokesQueue.enqueue({
      userId: user.id,
      organizationId: user.organizationId,
      events: dto.events.map((e) => ({
        keysPerMin: e.keysPerMin,
        mousePerMin: e.mousePerMin,
        recordedAt: typeof e.recordedAt === 'string' ? e.recordedAt : new Date(e.recordedAt).toISOString(),
      })),
    });
    return dto.events.length;
  }

  async saveTelemetry(user: User, dto: SyncTelemetryDto): Promise<void> {
    const entity = this.telemetryRepo.create({
      userId: user.id,
      organizationId: user.organizationId,
      agentVersion: (dto.agent_version ?? '').slice(0, 32),
      os: (dto.os ?? '').slice(0, 32),
      uptimeSec: dto.uptime_sec ?? 0,
      memUsedMb: dto.mem_used_mb ?? 0,
      cpuPercent: dto.cpu_percent ?? 0,
      lastSyncSuccess: dto.last_sync_success ?? false,
      lastSyncLatencyMs: dto.last_sync_latency_ms ?? 0,
      bufferedEvents: dto.buffered_events ?? 0,
      syncErrorCount: dto.sync_error_count ?? 0,
      hasScreenRecording: dto.has_screen_recording ?? false,
      hasAccessibility: dto.has_accessibility ?? false,
      urlDetectionLayer: dto.url_detection_layer ?? 0,
      recordedAt: new Date(),
    });
    await this.telemetryRepo.save(entity);
  }

  async getDevicesForOrg(orgId: string): Promise<AgentDevice[]> {
    return this.deviceRepo.find({
      where: { organizationId: orgId },
      order: { lastSeenAt: 'DESC' },
    });
  }

  async saveCrashReport(dto: CrashReportDto): Promise<void> {
    if (!dto.agent_version || !dto.os) return;
    const report: Record<string, unknown> = { ...dto };

    // Log for immediate visibility in application logs.
    this.logger.error(
      `Agent crash: org=${report['org_id'] ?? 'unknown'} ` +
      `employee=${report['employee_id'] ?? 'unknown'} ` +
      `version=${String(report['agent_version'])} ` +
      `os=${String(report['os'])} ` +
      `uptime_sec=${report['uptime_sec'] ?? 'unknown'} ` +
      `message=${String(report['message'] ?? '').slice(0, 500)}`,
    );

    // Persist to NDJSON file so reports survive API restarts.
    try {
      const logsDir = this.config.get<string>('CRASH_REPORTS_DIR', 'logs/crashes');
      await fs.promises.mkdir(logsDir, { recursive: true });
      const entry = JSON.stringify({
        ...report,
        received_at: new Date().toISOString(),
        message: String(report['message'] ?? '').slice(0, 2000),
        stack_trace: String(report['stack_trace'] ?? '').slice(0, 10000),
      }) + '\n';
      const filename = path.join(logsDir, `crashes-${new Date().toISOString().slice(0, 10)}.ndjson`);
      await fs.promises.appendFile(filename, entry, 'utf8');
    } catch (err) {
      this.logger.error('Failed to persist crash report to file', err);
    }
  }
}
