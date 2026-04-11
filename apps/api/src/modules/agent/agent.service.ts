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
import { RegisterAgentDto } from './dto/register-agent.dto';
import { CrashReportDto } from './dto/crash-report.dto';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
import { TokenService } from '../../infrastructure/token/token.service';

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
    private tokenService: TokenService,
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

  async saveActivities(user: User, dto: SyncActivityDto): Promise<number> {
    const entities = dto.events.map((e) =>
      this.activityRepo.create({
        userId: user.id,
        organizationId: user.organizationId,
        appName: e.appName.slice(0, 255),
        windowTitle: e.windowTitle ? e.windowTitle.slice(0, 500) : null,
        startedAt: new Date(e.startedAt),
        durationSec: e.durationSec ?? Math.round((e.durationMs ?? 0) / 1000),
        keystrokeCount: e.keystrokeCount ?? 0,
      }),
    );
    await this.activityRepo.save(entities);
    if (entities.length > 0) {
      const latest = entities[entities.length - 1];
      this.monitoringGateway?.emitActivityUpdate(user.organizationId, {
        userId: user.id,
        appName: latest.appName,
        windowTitle: latest.windowTitle ?? null,
        timestamp: latest.startedAt,
      });
    }
    return entities.length;
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

  async saveScreenshot(user: User, dto: SyncScreenshotDto): Promise<Screenshot> {
    const entity = this.screenshotRepo.create({
      userId: user.id,
      organizationId: user.organizationId,
      s3Key: dto.screenshotKey,
      capturedAt: new Date(dto.capturedAt),
      fileSizeBytes: dto.fileSizeBytes,
    });
    const saved = await this.screenshotRepo.save(entity);
    this.monitoringGateway?.emitScreenshotTaken(user.organizationId, {
      userId: user.id,
      screenshotId: saved.id,
      capturedAt: saved.capturedAt,
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
    // Validate and consume invite token (one-time use)
    this.logger.log(`Register attempt: token="${dto.inviteToken?.slice(0, 8)}..." len=${dto.inviteToken?.length}`);
    const userId = await this.tokenService.consume('invite', dto.inviteToken);
    this.logger.log(`Token consume result: userId="${userId}"`);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired invite token');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const deviceToken = randomUUID();
    const device = this.deviceRepo.create({
      organizationId: user.organizationId,
      userId: user.id,
      deviceToken,
      hostname: dto.hostname ?? null,
      platform: dto.os ?? null,
      agentVersion: dto.agentVersion ?? null,
      lastSeenAt: new Date(),
    });
    await this.deviceRepo.save(device);

    this.logger.log(`Agent registered: user=${user.id} org=${user.organizationId} host=${dto.hostname}`);
    return { agentToken: deviceToken, employeeId: user.id, orgId: user.organizationId };
  }

  async recordHeartbeat(user: User, dto: HeartbeatDto = {}): Promise<void> {
    const now = new Date();
    await this.deviceRepo.update(
      { userId: user.id, isActive: true },
      { lastSeenAt: now },
    );
    // Derive presence state from the agent's AFK self-report.
    // If the agent reports idle=true, flip the badge; otherwise mark online.
    // Offline transitions come from the periodic sweep cron in MonitoringService.
    this.monitoringGateway?.emitEmployeeStatus(user.organizationId, {
      userId: user.id,
      status: dto.idle ? 'idle' : 'online',
      lastSeen: now,
    });
  }

  async findDeviceByToken(token: string): Promise<AgentDevice | null> {
    return this.deviceRepo.findOne({ where: { deviceToken: token, isActive: true } });
  }

  async saveMetrics(user: User, dto: SyncMetricsDto): Promise<void> {
    // Identity (employeeId, orgId) is taken from the authenticated agent user,
    // NOT from the request body — prevents IDOR spoofing of metrics for another user.
    const records = dto.events.map((e) =>
      this.metricsRepo.create({
        employeeId: user.id,
        orgId: user.organizationId,
        cpuPercent: e.cpuPercent,
        memUsedMb: e.memUsedMb,
        memTotalMb: e.memTotalMb,
        agentCpuPercent: e.agentCpuPercent,
        agentMemMb: e.agentMemMb,
        recordedAt: new Date(e.recordedAt),
      }),
    );
    await this.metricsRepo.save(records);
  }

  async saveKeystrokes(user: User, dto: SyncKeystrokesDto): Promise<number> {
    const entities = dto.events.map((e) =>
      this.keystrokeRepo.create({
        userId: user.id,
        organizationId: user.organizationId,
        keysPerMin: e.keysPerMin,
        mousePerMin: e.mousePerMin,
        recordedAt: new Date(e.recordedAt),
      }),
    );
    await this.keystrokeRepo.save(entities);
    return entities.length;
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
