# Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Monitoring Dashboard — live employee status board, activity feed (app usage timeline), and screenshot gallery — backed by a new Agent Sync API that receives data from the Go desktop agent.

**Architecture:** Two new NestJS modules: `agent` (receives sync data from the Go desktop agent using a static UUID agent-token stored on the user record) and `monitoring` (serves dashboard queries to managers/admins). The Go agent already sends `POST /agent/sync/activity`, `GET /agent/sync/screenshots/upload-url`, and `POST /agent/sync/screenshots` — these endpoints are built here. Screenshots are stored as S3 keys; presigned GET URLs are generated on demand. Live status combines open attendance records with the most recent activity event per employee.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL with RLS, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for S3, Next.js 14 App Router, TanStack Query, shadcn/ui, Tailwind CSS.

---

## File Map

```
apps/api/src/
├── database/
│   ├── entities/
│   │   ├── activity-event.entity.ts         ← app usage record from agent
│   │   └── screenshot.entity.ts             ← screenshot metadata (s3 key + capturedAt)
│   └── migrations/
│       └── 003_monitoring_schema.ts         ← activity_events + screenshots + agent_token col
└── modules/
    ├── agent/
    │   ├── dto/
    │   │   ├── sync-activity.dto.ts         ← array of activity events from agent
    │   │   └── sync-screenshot.dto.ts       ← screenshot metadata after S3 upload
    │   ├── agent-auth.guard.ts              ← validates Bearer agentToken vs users.agent_token
    │   ├── agent-current-user.decorator.ts  ← extracts agentUser from request
    │   ├── agent.service.ts                 ← saveActivities, generateUploadUrl, saveScreenshot
    │   ├── agent.controller.ts              ← POST /agent/sync/activity, screenshots/*, keystrokes
    │   └── agent.module.ts
    └── monitoring/
        ├── monitoring.service.ts            ← getLiveStatus, getActivity, getScreenshots
        ├── monitoring.service.spec.ts       ← Jest unit tests (mocked repos)
        ├── monitoring.controller.ts         ← GET /monitoring/live, /activity, /screenshots
        └── monitoring.module.ts

apps/web/
├── hooks/
│   └── use-monitoring.ts                   ← useLiveStatus (30s poll), useActivity, useScreenshots
├── components/monitoring/
│   ├── live-status-board.tsx               ← employee cards with current app + elapsed time
│   ├── activity-timeline.tsx               ← horizontal app usage bars for selected employee
│   └── screenshot-gallery.tsx             ← grid of screenshots with click-to-expand lightbox
└── app/(dashboard)/monitoring/
    └── page.tsx                            ← Monitoring Dashboard page
```

---

## Task 1: Database Migration

**Files:**
- Create: `apps/api/src/database/migrations/003_monitoring_schema.ts`

- [ ] **Step 1: Create `apps/api/src/database/migrations/003_monitoring_schema.ts`**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonitoringSchema1712200000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add agent_token to users — UUID each employee uses to authenticate the desktop agent
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_token UUID DEFAULT uuid_generate_v4();
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_agent_token ON users(agent_token) WHERE agent_token IS NOT NULL;
    `);

    // activity_events — app/window usage records sent by the Go agent
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        app_name        VARCHAR(255) NOT NULL,
        window_title    VARCHAR(500),
        started_at      TIMESTAMPTZ NOT NULL,
        duration_sec    INTEGER NOT NULL DEFAULT 0,
        keystroke_count INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_activity_events_user_org    ON activity_events(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_started_at  ON activity_events(started_at DESC);

      ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON activity_events
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // screenshots — metadata only; actual image lives in S3
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        s3_key          VARCHAR(500) NOT NULL,
        captured_at     TIMESTAMPTZ NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_screenshots_user_org    ON screenshots(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC);

      ALTER TABLE screenshots ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON screenshots
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS screenshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS activity_events`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS agent_token`);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/database/migrations/ && git commit -m "feat(api): add monitoring schema migration (activity_events, screenshots, agent_token)"
```

---

## Task 2: TypeORM Entities

**Files:**
- Create: `apps/api/src/database/entities/activity-event.entity.ts`
- Create: `apps/api/src/database/entities/screenshot.entity.ts`
- Modify: `apps/api/src/database/entities/user.entity.ts` — add `agentToken` field

- [ ] **Step 1: Create `apps/api/src/database/entities/activity-event.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('activity_events')
export class ActivityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'app_name', length: 255 })
  appName: string;

  @Column({ name: 'window_title', length: 500, nullable: true })
  windowTitle: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'duration_sec', default: 0 })
  durationSec: number;

  @Column({ name: 'keystroke_count', default: 0 })
  keystrokeCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: Create `apps/api/src/database/entities/screenshot.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('screenshots')
export class Screenshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 's3_key', length: 500 })
  s3Key: string;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'file_size_bytes', default: 0 })
  fileSizeBytes: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: Add `agentToken` to `apps/api/src/database/entities/user.entity.ts`**

Add this column after the `isActive` column:

```typescript
  @Column({ name: 'agent_token', type: 'uuid', nullable: true, unique: true, select: false })
  agentToken: string | null;
```

The full updated `user.entity.ts`:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from './organization.entity';

export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ length: 255 })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ length: 255 })
  firstName: string;

  @Column({ length: 255 })
  lastName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  invitedBy: string;

  @Column({ name: 'agent_token', type: 'uuid', nullable: true, unique: true, select: false })
  agentToken: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/database/entities/ && git commit -m "feat(api): add ActivityEvent and Screenshot entities; add agentToken to User"
```

---

## Task 3: Agent Module (Auth Guard + Sync Endpoints)

**Files:**
- Create: `apps/api/src/modules/agent/agent-auth.guard.ts`
- Create: `apps/api/src/modules/agent/agent-current-user.decorator.ts`
- Create: `apps/api/src/modules/agent/dto/sync-activity.dto.ts`
- Create: `apps/api/src/modules/agent/dto/sync-screenshot.dto.ts`
- Create: `apps/api/src/modules/agent/agent.service.ts`
- Create: `apps/api/src/modules/agent/agent.controller.ts`
- Create: `apps/api/src/modules/agent/agent.module.ts`

Before creating files, install the AWS S3 SDK (needed for presigned upload URLs):

```bash
cd "D:/Time champ-agent/apps/api" && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner 2>&1 | tail -5
```

- [ ] **Step 1: Create `apps/api/src/modules/agent/agent-auth.guard.ts`**

```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing agent token');
    }
    const token = auth.slice(7);

    // agent_token has select: false so we must explicitly select it
    const user = await this.userRepo
      .createQueryBuilder('user')
      .addSelect('user.agentToken')
      .where('user.agentToken = :token AND user.isActive = true', { token })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid agent token');
    }

    req.agentUser = user;
    return true;
  }
}
```

- [ ] **Step 2: Create `apps/api/src/modules/agent/agent-current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../database/entities/user.entity';

export const AgentCurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): User =>
    ctx.switchToHttp().getRequest().agentUser,
);
```

- [ ] **Step 3: Create `apps/api/src/modules/agent/dto/sync-activity.dto.ts`**

```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ActivityEventItemDto {
  @ApiProperty({ example: 'Visual Studio Code' })
  @IsString()
  appName: string;

  @ApiPropertyOptional({ example: 'main.go — myproject' })
  @IsOptional()
  @IsString()
  windowTitle?: string;

  @ApiProperty({ example: '2026-04-02T09:00:00.000Z' })
  @IsISO8601()
  startedAt: string;

  @ApiProperty({ example: 120 })
  @IsInt()
  @Min(0)
  durationSec: number;

  @ApiPropertyOptional({ example: 42 })
  @IsOptional()
  @IsInt()
  @Min(0)
  keystrokeCount?: number;
}

export class SyncActivityDto {
  @ApiProperty({ type: [ActivityEventItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityEventItemDto)
  events: ActivityEventItemDto[];
}
```

- [ ] **Step 4: Create `apps/api/src/modules/agent/dto/sync-screenshot.dto.ts`**

```typescript
import { IsISO8601, IsInt, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SyncScreenshotDto {
  @ApiProperty({ example: 'screenshots/org-id/user-id/2026-04-02T09-00-00.jpg' })
  @IsString()
  screenshotKey: string;

  @ApiProperty({ example: '2026-04-02T09:00:00.000Z' })
  @IsISO8601()
  capturedAt: string;

  @ApiProperty({ example: 204800 })
  @IsInt()
  @Min(0)
  fileSizeBytes: number;
}
```

- [ ] **Step 5: Create `apps/api/src/modules/agent/agent.service.ts`**

```typescript
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { User } from '../../database/entities/user.entity';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';

@Injectable()
export class AgentService {
  private s3: S3Client | null = null;
  private bucket: string | null = null;

  constructor(
    private config: ConfigService,
    @InjectRepository(ActivityEvent)
    private activityRepo: Repository<ActivityEvent>,
    @InjectRepository(Screenshot)
    private screenshotRepo: Repository<Screenshot>,
  ) {
    const bucket = this.config.get<string>('S3_BUCKET');
    const region = this.config.get<string>('AWS_REGION', 'us-east-1');
    if (bucket) {
      this.bucket = bucket;
      this.s3 = new S3Client({ region });
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
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    return getSignedUrl(this.s3, command, { expiresIn: 3600 });
  }
}
```

- [ ] **Step 6: Create `apps/api/src/modules/agent/agent.controller.ts`**

```typescript
import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentCurrentUser } from './agent-current-user.decorator';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';
import { User } from '../../database/entities/user.entity';

@ApiTags('Agent Sync')
@UseGuards(AgentAuthGuard)
@Controller('agent/sync')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Post('activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload activity events from the desktop agent' })
  async syncActivity(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncActivityDto,
  ) {
    const saved = await this.service.saveActivities(user, dto);
    return { saved };
  }

  @Post('keystrokes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keystroke counts (rolled up into activity events, no-op here)' })
  syncKeystrokes() {
    // Keystroke counts are already included in SyncActivityDto.keystrokeCount.
    // This endpoint exists so the Go agent does not receive 404 errors.
    return { accepted: true };
  }

  @Get('screenshots/upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for screenshot upload' })
  getUploadUrl(@AgentCurrentUser() user: User) {
    return this.service.generateUploadUrl(user);
  }

  @Post('screenshots')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save screenshot metadata after S3 upload completes' })
  saveScreenshot(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncScreenshotDto,
  ) {
    return this.service.saveScreenshot(user, dto);
  }
}
```

- [ ] **Step 7: Create `apps/api/src/modules/agent/agent.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { User } from '../../database/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, Screenshot, User])],
  controllers: [AgentController],
  providers: [AgentService, AgentAuthGuard],
  exports: [AgentService],
})
export class AgentModule {}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors (pre-existing billing.service errors are unrelated).

- [ ] **Step 9: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/agent/ && git commit -m "feat(api): add agent sync module (activity, keystrokes, screenshots) with agent-token auth"
```

---

## Task 4: MonitoringService + Unit Tests

**Files:**
- Create: `apps/api/src/modules/monitoring/monitoring.service.spec.ts`
- Create: `apps/api/src/modules/monitoring/monitoring.service.ts`

- [ ] **Step 1: Create `apps/api/src/modules/monitoring/monitoring.service.spec.ts`**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MonitoringService } from './monitoring.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { User } from '../../database/entities/user.entity';
import { AgentService } from '../agent/agent.service';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  createQueryBuilder: jest.Mock;
};

function mockRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('MonitoringService', () => {
  let service: MonitoringService;
  let activityRepo: MockRepo;
  let screenshotRepo: MockRepo;
  let attendanceRepo: MockRepo;
  let agentService: { getPresignedDownloadUrl: jest.Mock };

  beforeEach(async () => {
    activityRepo = mockRepo();
    screenshotRepo = mockRepo();
    attendanceRepo = mockRepo();
    agentService = { getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringService,
        { provide: getRepositoryToken(ActivityEvent), useValue: activityRepo },
        { provide: getRepositoryToken(Screenshot), useValue: screenshotRepo },
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: AgentService, useValue: agentService },
      ],
    }).compile();

    service = module.get<MonitoringService>(MonitoringService);
  });

  // ── getActivity ────────────────────────────────────────────────────
  describe('getActivity', () => {
    it('returns activity events for a user', async () => {
      const events: Partial<ActivityEvent>[] = [
        { id: 'evt-1', appName: 'Chrome', durationSec: 300, startedAt: new Date() },
        { id: 'evt-2', appName: 'VSCode', durationSec: 600, startedAt: new Date() },
      ];
      activityRepo.find.mockResolvedValue(events);

      const result = await service.getActivity('u-1', 'org-1', {});

      expect(activityRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u-1', organizationId: 'org-1' }) }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].appName).toBe('Chrome');
    });

    it('returns all org activity when userId is undefined (manager view)', async () => {
      activityRepo.find.mockResolvedValue([]);
      await service.getActivity(undefined, 'org-1', {});
      expect(activityRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
      );
      // userId should NOT be in the where clause
      const callArg = activityRepo.find.mock.calls[0][0];
      expect(callArg.where.userId).toBeUndefined();
    });
  });

  // ── getScreenshots ──────────────────────────────────────────────────
  describe('getScreenshots', () => {
    it('returns screenshots with presigned URLs', async () => {
      const shots: Partial<Screenshot>[] = [
        { id: 'sc-1', s3Key: 'screenshots/org/user/ts.jpg', capturedAt: new Date() },
      ];
      screenshotRepo.find.mockResolvedValue(shots);

      const result = await service.getScreenshots('u-1', 'org-1', {});

      expect(agentService.getPresignedDownloadUrl).toHaveBeenCalledWith('screenshots/org/user/ts.jpg');
      expect(result[0].url).toBe('https://s3.example.com/signed');
    });

    it('returns screenshots for all org when userId is undefined', async () => {
      screenshotRepo.find.mockResolvedValue([]);
      await service.getScreenshots(undefined, 'org-1', {});
      const callArg = screenshotRepo.find.mock.calls[0][0];
      expect(callArg.where.userId).toBeUndefined();
    });
  });

  // ── getLiveStatus ──────────────────────────────────────────────────
  describe('getLiveStatus', () => {
    it('returns live employee records from open attendance', async () => {
      const clockInTime = new Date(Date.now() - 3_600_000);
      const attendances: Partial<Attendance>[] = [
        {
          id: 'att-1',
          userId: 'u-1',
          clockIn: clockInTime,
          clockOut: null,
          user: { firstName: 'Alice', lastName: 'Smith' } as User,
        },
      ];
      attendanceRepo.find.mockResolvedValue(attendances);
      activityRepo.findOne.mockResolvedValue({ appName: 'Chrome', startedAt: new Date() });

      const result = await service.getLiveStatus('org-1');

      expect(result).toHaveLength(1);
      expect(result[0].userId).toBe('u-1');
      expect(result[0].currentApp).toBe('Chrome');
    });

    it('returns empty array when no employees are clocked in', async () => {
      attendanceRepo.find.mockResolvedValue([]);
      const result = await service.getLiveStatus('org-1');
      expect(result).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (service not found)**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest monitoring.service --no-coverage 2>&1 | tail -5
```

Expected: Error — `Cannot find module './monitoring.service'`

- [ ] **Step 3: Create `apps/api/src/modules/monitoring/monitoring.service.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest monitoring.service --no-coverage 2>&1 | tail -15
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/monitoring/ && git commit -m "feat(api): implement MonitoringService with TDD (getLiveStatus, getActivity, getScreenshots)"
```

---

## Task 5: MonitoringController

**Files:**
- Create: `apps/api/src/modules/monitoring/monitoring.controller.ts`

- [ ] **Step 1: Create `apps/api/src/modules/monitoring/monitoring.controller.ts`**

```typescript
import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { MonitoringService } from './monitoring.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Monitoring')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}

  @Get('live')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all currently clocked-in employees with their current app' })
  getLiveStatus(@CurrentUser() user: User) {
    return this.service.getLiveStatus(user.organizationId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'List activity events. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getActivity(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Employees can only see their own activity
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getActivity(targetUserId, user.organizationId, { from, to });
  }

  @Get('screenshots')
  @ApiOperation({ summary: 'List screenshots. Employees see own; managers see all or filter by userId.' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getScreenshots(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const targetUserId =
      user.role === UserRole.EMPLOYEE ? user.id : (userId ?? undefined);
    return this.service.getScreenshots(targetUserId, user.organizationId, { from, to });
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/monitoring/monitoring.controller.ts && git commit -m "feat(api): add MonitoringController (live status, activity, screenshots)"
```

---

## Task 6: Module Wiring + AppModule Update

**Files:**
- Create: `apps/api/src/modules/monitoring/monitoring.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/modules/monitoring/monitoring.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEvent, Screenshot, Attendance]),
    AgentModule,
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
```

- [ ] **Step 2: Read `apps/api/src/app.module.ts` and update it**

Add these imports at the top:
```typescript
import { AgentModule } from './modules/agent/agent.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { ActivityEvent } from './database/entities/activity-event.entity';
import { Screenshot } from './database/entities/screenshot.entity';
```

Add `ActivityEvent` and `Screenshot` to the TypeORM entities array.

Add `AgentModule` and `MonitoringModule` to the `@Module` imports array.

The full updated `app.module.ts`:

```typescript
import * as Joi from 'joi';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { AgentModule } from './modules/agent/agent.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { Organization } from './database/entities/organization.entity';
import { User } from './database/entities/user.entity';
import { Subscription } from './database/entities/subscription.entity';
import { RefreshToken } from './database/entities/refresh-token.entity';
import { Attendance } from './database/entities/attendance.entity';
import { TimeEntry } from './database/entities/time-entry.entity';
import { Timesheet } from './database/entities/timesheet.entity';
import { ActivityEvent } from './database/entities/activity-event.entity';
import { Screenshot } from './database/entities/screenshot.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        STRIPE_SECRET_KEY: Joi.string().required(),
        APP_URL: Joi.string().uri().required(),
        S3_BUCKET: Joi.string().optional(),
        AWS_REGION: Joi.string().default('us-east-1'),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [
          Organization,
          User,
          Subscription,
          RefreshToken,
          Attendance,
          TimeEntry,
          Timesheet,
          ActivityEvent,
          Screenshot,
        ],
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') !== 'production',
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : false,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    TimeTrackingModule,
    AgentModule,
    MonitoringModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 3: Run all API tests**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -15
```

Expected: All tests pass (13 time-tracking + monitoring tests).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/monitoring/monitoring.module.ts apps/api/src/app.module.ts && git commit -m "feat(api): wire AgentModule and MonitoringModule into AppModule"
```

---

## Task 7: Frontend TanStack Query Hooks

**Files:**
- Create: `apps/web/hooks/use-monitoring.ts`

- [ ] **Step 1: Create `apps/web/hooks/use-monitoring.ts`**

```typescript
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type LiveEmployee = {
  userId: string;
  firstName: string;
  lastName: string;
  clockedInSince: string;
  currentApp: string | null;
  lastSeenAt: string | null;
};

export type ActivityEvent = {
  id: string;
  userId: string;
  appName: string;
  windowTitle: string | null;
  startedAt: string;
  durationSec: number;
  keystrokeCount: number;
  createdAt: string;
};

export type ScreenshotItem = {
  id: string;
  userId: string;
  capturedAt: string;
  fileSizeBytes: number;
  url: string;
};

// ── Live Status ────────────────────────────────────────────────────────

export function useLiveStatus() {
  return useQuery({
    queryKey: ['monitoring-live'],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/live');
      return data.data as LiveEmployee[];
    },
    refetchInterval: 30_000,
  });
}

// ── Activity ───────────────────────────────────────────────────────────

export function useActivity(params?: {
  userId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ['monitoring-activity', params],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/activity', { params });
      return data.data as ActivityEvent[];
    },
    onError: () => toast.error('Failed to load activity'),
  } as any);
}

// ── Screenshots ────────────────────────────────────────────────────────

export function useScreenshots(params?: {
  userId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: ['monitoring-screenshots', params],
    queryFn: async () => {
      const { data } = await api.get('/monitoring/screenshots', { params });
      return data.data as ScreenshotItem[];
    },
    onError: () => toast.error('Failed to load screenshots'),
  } as any);
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Elapsed time from a date string to now, formatted "Xh Ym" */
export function elapsedSince(isoString: string): string {
  const ms = Date.now() - new Date(isoString).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Today's date in 'YYYY-MM-DD' format */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/hooks/use-monitoring.ts && git commit -m "feat(web): add monitoring TanStack Query hooks (live status, activity, screenshots)"
```

---

## Task 8: Frontend Components + Monitoring Page

**Files:**
- Create: `apps/web/components/monitoring/live-status-board.tsx`
- Create: `apps/web/components/monitoring/activity-timeline.tsx`
- Create: `apps/web/components/monitoring/screenshot-gallery.tsx`
- Create: `apps/web/app/(dashboard)/monitoring/page.tsx`
- Modify: `apps/web/components/dashboard/sidebar.tsx` — add Monitoring nav item

- [ ] **Step 1: Create `apps/web/components/monitoring/live-status-board.tsx`**

```tsx
'use client';

import { useLiveStatus, elapsedSince } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function initials(first: string, last: string): string {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

export function LiveStatusBoard() {
  const { data: employees = [], isLoading } = useLiveStatus();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading live status...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          Live — {employees.length} online
        </CardTitle>
      </CardHeader>
      <CardContent>
        {employees.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No employees currently clocked in.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {employees.map((emp) => (
              <div
                key={emp.userId}
                className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
                  {initials(emp.firstName, emp.lastName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {emp.firstName} {emp.lastName}
                  </p>
                  <p className="text-xs text-slate-500 truncate">
                    {emp.currentApp ?? 'Idle'} · {elapsedSince(emp.clockedInSince)}
                  </p>
                </div>
                <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/monitoring/activity-timeline.tsx`**

```tsx
'use client';

import { useActivity } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// 20 distinct colours cycling for app names
const COLOURS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
  '#14b8a6', '#f43f5e', '#a3e635', '#fb923c', '#c084fc',
  '#34d399', '#fbbf24', '#60a5fa', '#e879f9', '#4ade80',
];

const appColor = (() => {
  const map = new Map<string, string>();
  let idx = 0;
  return (name: string) => {
    if (!map.has(name)) map.set(name, COLOURS[idx++ % COLOURS.length]);
    return map.get(name)!;
  };
})();

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface Props {
  userId?: string;
  from?: string;
  to?: string;
}

export function ActivityTimeline({ userId, from, to }: Props) {
  const { data: events = [], isLoading } = useActivity({ userId, from, to });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading activity...
        </CardContent>
      </Card>
    );
  }

  // Group by app, sum durations
  const appTotals = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.appName] = (acc[e.appName] ?? 0) + e.durationSec;
    return acc;
  }, {});
  const sorted = Object.entries(appTotals).sort((a, b) => b[1] - a[1]);
  const totalSec = sorted.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>App Usage</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-center text-slate-400 text-sm py-4">
            No activity recorded for this period.
          </p>
        ) : (
          <div className="space-y-2.5">
            {sorted.slice(0, 15).map(([app, sec]) => (
              <div key={app} className="flex items-center gap-3">
                <div className="w-32 shrink-0 text-sm text-slate-700 truncate" title={app}>
                  {app}
                </div>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, (sec / totalSec) * 100)}%`,
                      backgroundColor: appColor(app),
                    }}
                  />
                </div>
                <div className="w-16 shrink-0 text-xs text-slate-500 text-right">
                  {fmtDuration(sec)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/monitoring/screenshot-gallery.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useScreenshots } from '@/hooks/use-monitoring';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface Props {
  userId?: string;
  from?: string;
  to?: string;
}

export function ScreenshotGallery({ userId, from, to }: Props) {
  const { data: screenshots = [], isLoading } = useScreenshots({ userId, from, to });
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading screenshots...
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Screenshots ({screenshots.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {screenshots.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-4">
              No screenshots for this period.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {screenshots.map((sc) => (
                <button
                  key={sc.id}
                  className="relative rounded-lg overflow-hidden border border-slate-200 hover:border-blue-400 hover:ring-2 hover:ring-blue-200 transition-all aspect-video bg-slate-100 group"
                  onClick={() => setLightbox(sc.url)}
                  aria-label={`Screenshot taken at ${new Date(sc.capturedAt).toLocaleTimeString()}`}
                >
                  {sc.url ? (
                    <img
                      src={sc.url}
                      alt="Screenshot"
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">
                      No preview
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(sc.capturedAt).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-5xl w-full" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="absolute -top-10 right-0 text-white hover:text-white hover:bg-white/20"
              onClick={() => setLightbox(null)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </Button>
            <img
              src={lightbox}
              alt="Screenshot fullscreen"
              className="w-full rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/(dashboard)/monitoring/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { LiveStatusBoard } from '@/components/monitoring/live-status-board';
import { ActivityTimeline } from '@/components/monitoring/activity-timeline';
import { ScreenshotGallery } from '@/components/monitoring/screenshot-gallery';
import { todayISO } from '@/hooks/use-monitoring';

export default function MonitoringPage() {
  const { data: session } = useSession();
  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';

  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(
    isManager ? undefined : session?.user?.id,
  );
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const from = `${selectedDate}T00:00:00.000Z`;
  const to = `${selectedDate}T23:59:59.999Z`;

  return (
    <>
      <Header title="Monitoring" />
      <div className="p-6 space-y-6 max-w-7xl">
        {/* Live Status — managers only */}
        {isManager && <LiveStatusBoard />}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="text-sm font-medium text-slate-700">Date</label>
          <input
            type="date"
            aria-label="Select date"
            value={selectedDate}
            max={todayISO()}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
          {isManager && (
            <>
              <label className="text-sm font-medium text-slate-700 ml-2">
                Employee ID (optional)
              </label>
              <input
                type="text"
                aria-label="Filter by employee UUID"
                placeholder="all employees"
                value={selectedUserId ?? ''}
                onChange={(e) =>
                  setSelectedUserId(e.target.value.trim() || undefined)
                }
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </>
          )}
        </div>

        {/* Activity + Screenshots */}
        <ActivityTimeline userId={selectedUserId} from={from} to={to} />
        <ScreenshotGallery userId={selectedUserId} from={from} to={to} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Add Monitoring to sidebar in `apps/web/components/dashboard/sidebar.tsx`**

Add `Monitor` to the lucide-react imports and add the monitoring nav item. Read the file first, then make this change:

In the imports, change:
```typescript
import {
  LayoutDashboard,
  Users,
  Clock,
  FolderKanban,
  MapPin,
  BarChart3,
  Plug,
  Bell,
  Settings,
} from 'lucide-react';
```

To:
```typescript
import {
  LayoutDashboard,
  Users,
  Clock,
  Monitor,
  FolderKanban,
  MapPin,
  BarChart3,
  Plug,
  Bell,
  Settings,
} from 'lucide-react';
```

And add this entry to `navItems` after Time Tracking:
```typescript
  { href: '/monitoring', label: 'Monitoring', icon: Monitor },
```

The full updated navItems array:
```typescript
const navItems = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/time-tracking', label: 'Time Tracking', icon: Clock },
  { href: '/monitoring', label: 'Monitoring', icon: Monitor },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/gps', label: 'GPS & Field', icon: MapPin },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/settings/organization', label: 'Settings', icon: Settings },
];
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -30
```

Expected: No new errors from monitoring files.

- [ ] **Step 7: Run all API tests**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/components/monitoring/ "apps/web/app/(dashboard)/monitoring/" apps/web/components/dashboard/sidebar.tsx && git commit -m "feat(web): add monitoring dashboard (live board, activity timeline, screenshot gallery)"
```

---

## Self-Review

**Spec coverage:**
- ✅ Screenshots viewer — `ScreenshotGallery` with lightbox, `GET /monitoring/screenshots`, S3 presigned URLs
- ✅ Activity feed (app usage timeline) — `ActivityTimeline` horizontal bars, `GET /monitoring/activity`
- ✅ Live employee status board — `LiveStatusBoard` with polling, `GET /monitoring/live`
- ✅ Agent sync endpoints — `POST /agent/sync/activity`, `POST /agent/sync/screenshots`, `GET /agent/sync/screenshots/upload-url`
- ✅ Agent authentication — `AgentAuthGuard` using `users.agent_token` UUID
- ✅ Role-based access — managers see all, employees see own data
- ✅ Monitoring page at `/monitoring` with sidebar link

**Placeholder scan:** All steps contain complete code. No TBD / TODO / placeholder text.

**Type consistency:** `LiveEmployee`, `ActivityEvent`, `ScreenshotItem` types defined in `use-monitoring.ts` and match the service return types. `AgentCurrentUser` decorator returns `User` which matches what `AgentAuthGuard` sets on `req.agentUser`.
