import { Injectable, ServiceUnavailableException, UnauthorizedException, Optional, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { User } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';
import { SyncGpsDto } from './dto/sync-gps.dto';
import { RegisterAgentDto } from './dto/register-agent.dto';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private s3: S3Client | null = null;
  private bucket: string | null = null;
  private cdnUrl: string | null = null;

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
    @Optional() @Inject('TOKEN_SERVICE') private tokenService: any,
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
  }

  async saveActivities(user: User, dto: SyncActivityDto): Promise<number> {
    const entities = dto.events.map((e) =>
      this.activityRepo.create({
        userId: user.id,
        organizationId: user.organizationId,
        appName: e.appName,
        windowTitle: e.windowTitle ?? null,
        startedAt: new Date(e.startedAt),
        durationSec: e.durationSec,
        keystrokeCount: e.keystrokeCount ?? 0,
      }),
    );
    await this.activityRepo.save(entities);
    return entities.length;
  }

  async generateUploadUrl(user: User): Promise<{ uploadUrl: string; screenshotKey: string }> {
    if (!this.s3 || !this.bucket) {
      throw new ServiceUnavailableException(
        'Screenshot storage is not configured (S3_BUCKET env var missing)',
      );
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotKey = `screenshots/${user.organizationId}/${user.id}/${ts}.jpg`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: screenshotKey,
      ContentType: 'image/jpeg',
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: 300 });

    return { uploadUrl, screenshotKey };
  }

  async saveScreenshot(user: User, dto: SyncScreenshotDto): Promise<Screenshot> {
    const entity = this.screenshotRepo.create({
      userId: user.id,
      organizationId: user.organizationId,
      s3Key: dto.screenshotKey,
      capturedAt: new Date(dto.capturedAt),
      fileSizeBytes: dto.fileSizeBytes,
    });
    return this.screenshotRepo.save(entity);
  }

  async getPresignedDownloadUrl(s3Key: string): Promise<string> {
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
    // Validate invite token
    let userId: string | null = null;
    if (this.tokenService) {
      userId = await this.tokenService.peek('invite', dto.inviteToken);
    }
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

  async recordHeartbeat(user: User): Promise<void> {
    await this.deviceRepo.update(
      { userId: user.id, isActive: true },
      { lastSeenAt: new Date() },
    );
  }

  async findDeviceByToken(token: string): Promise<AgentDevice | null> {
    return this.deviceRepo.findOne({ where: { deviceToken: token, isActive: true } });
  }
}
