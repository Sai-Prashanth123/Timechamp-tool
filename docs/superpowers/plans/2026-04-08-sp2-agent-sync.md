# SP2: Agent → API Sync Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add agent device registration, device-based auth, heartbeat, and real-time Socket.IO monitoring events so manager browsers see employee status update live as agents sync.

**Architecture:** Agents register with an invite token → API creates an `agent_devices` record and returns `device_token` → all subsequent sync calls authenticate via that token → API emits Socket.IO events to connected manager browsers via `MonitoringGateway` after each heartbeat/activity/screenshot sync.

**Tech Stack:** NestJS + TypeORM (agent_devices table), ioredis (heartbeat caching), Socket.IO (monitoring gateway, `/monitoring` namespace), JWT (manager WS auth).

---

## What Is Already Complete — Do Not Rewrite

| File | Status |
|------|--------|
| `apps/agent/internal/sync/register.go` | Complete — calls `POST /agent/register`, stores returned agentToken in keychain |
| `apps/agent/internal/sync/uploader.go` | Complete — FlushActivity, FlushScreenshots, FlushGps all POST to sync endpoints |
| `apps/agent/cmd/agent/main.go` | Complete — orchestrator with all goroutines |
| `apps/api/src/modules/agent/agent.service.ts` | Complete — saveActivities, generateUploadUrl, saveScreenshot, saveGpsLocations, getOrgConfig |
| `apps/api/src/modules/agent/agent.controller.ts` | Complete — all sync endpoints under `@Controller('agent/sync')` |
| `apps/api/src/modules/monitoring/monitoring.service.ts` | Complete — getActivity, getScreenshots, getLiveStatus |
| `apps/api/src/modules/monitoring/monitoring.controller.ts` | Complete — all monitoring GET endpoints |

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/api/src/database/migrations/011_agent_devices.ts` | `agent_devices` table DDL |
| Create | `apps/api/src/database/entities/agent-device.entity.ts` | TypeORM entity for agent_devices |
| Create | `apps/api/src/modules/agent/dto/register-agent.dto.ts` | Input validation for POST /agent/register |
| Modify | `apps/api/src/modules/agent/agent.service.ts` | Add registerAgent(), recordHeartbeat(), emit via MonitoringGateway |
| Modify | `apps/api/src/modules/agent/agent-auth.guard.ts` | Look up token from agent_devices instead of user.agentToken |
| Create | `apps/api/src/modules/agent/agent-registration.controller.ts` | POST /agent/register (separate from /agent/sync prefix) |
| Modify | `apps/api/src/modules/agent/agent.controller.ts` | Add POST /agent/sync/heartbeat |
| Modify | `apps/api/src/modules/agent/agent.module.ts` | Add AgentDevice entity, AgentRegistrationController, forwardRef MonitoringModule |
| Create | `apps/api/src/modules/monitoring/monitoring.gateway.ts` | Socket.IO gateway at /monitoring namespace for manager browsers |
| Modify | `apps/api/src/modules/monitoring/monitoring.module.ts` | Provide and export MonitoringGateway |
| Create | `apps/api/src/modules/agent/agent.service.spec.ts` | Unit tests for registerAgent, recordHeartbeat |
| Create | `apps/api/src/modules/agent/agent-auth.guard.spec.ts` | Unit tests for updated guard |

---

## Task 1: DB Migration 011 — agent_devices Table

**Files:**
- Create: `apps/api/src/database/migrations/011_agent_devices.ts`

- [ ] **Step 1: Write the migration**

```typescript
// apps/api/src/database/migrations/011_agent_devices.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentDevices1743782400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS agent_devices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token    VARCHAR(255) UNIQUE NOT NULL,
        hostname        VARCHAR(255),
        platform        VARCHAR(50),
        agent_version   VARCHAR(50),
        last_seen_at    TIMESTAMPTZ,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_token  ON agent_devices(device_token);`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_user   ON agent_devices(user_id);`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_org    ON agent_devices(organization_id);`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS agent_devices;`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/database/migrations/011_agent_devices.ts
git commit -m "feat(db): add agent_devices table migration 011"
```

---

## Task 2: AgentDevice Entity

**Files:**
- Create: `apps/api/src/database/entities/agent-device.entity.ts`

- [ ] **Step 1: Write the entity**

```typescript
// apps/api/src/database/entities/agent-device.entity.ts
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Organization } from './organization.entity';

@Entity('agent_devices')
export class AgentDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'device_token', unique: true })
  deviceToken: string;

  @Column({ nullable: true })
  hostname: string | null;

  @Column({ nullable: true })
  platform: string | null;

  @Column({ name: 'agent_version', nullable: true })
  agentVersion: string | null;

  @Column({ name: 'last_seen_at', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/database/entities/agent-device.entity.ts
git commit -m "feat(agent): add AgentDevice TypeORM entity"
```

---

## Task 3: RegisterAgentDto + AgentService.registerAgent()

**Files:**
- Create: `apps/api/src/modules/agent/dto/register-agent.dto.ts`
- Modify: `apps/api/src/modules/agent/agent.service.ts`
- Create: `apps/api/src/modules/agent/agent.service.spec.ts`

- [ ] **Step 1: Write the DTO**

```typescript
// apps/api/src/modules/agent/dto/register-agent.dto.ts
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterAgentDto {
  @ApiProperty({ description: 'One-time invite token from email link' })
  @IsString()
  inviteToken: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  hostname?: string;

  @ApiProperty({ required: false, description: 'windows | darwin | linux' })
  @IsString()
  @IsOptional()
  os?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  osVersion?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  agentVersion?: string;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// apps/api/src/modules/agent/agent.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AgentService } from './agent.service';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { User } from '../../database/entities/user.entity';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Organization } from '../../database/entities/organization.entity';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

const mockUser = {
  id: 'user-uuid',
  organizationId: 'org-uuid',
  isActive: true,
};

const mockTokenService = {
  peek: jest.fn(),
};

const mockDeviceRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};

const mockUserRepo = {
  findOne: jest.fn(),
};

const mockOrgRepo = { findOne: jest.fn() };
const mockActivityRepo = { create: jest.fn(), save: jest.fn() };
const mockScreenshotRepo = { create: jest.fn(), save: jest.fn() };
const mockGpsRepo = { create: jest.fn(), save: jest.fn() };
const mockConfig = { get: jest.fn() };

describe('AgentService.registerAgent', () => {
  let service: AgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: getRepositoryToken(AgentDevice), useValue: mockDeviceRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(ActivityEvent), useValue: mockActivityRepo },
        { provide: getRepositoryToken(Screenshot), useValue: mockScreenshotRepo },
        { provide: getRepositoryToken(GpsLocation), useValue: mockGpsRepo },
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        { provide: ConfigService, useValue: mockConfig },
        { provide: 'TOKEN_SERVICE', useValue: mockTokenService },
      ],
    }).compile();
    service = module.get<AgentService>(AgentService);
    jest.clearAllMocks();
  });

  it('returns agentToken + employeeId + orgId on valid invite token', async () => {
    mockTokenService.peek.mockResolvedValue('user-uuid');
    mockUserRepo.findOne.mockResolvedValue(mockUser);
    mockDeviceRepo.create.mockReturnValue({ deviceToken: 'generated-uuid' });
    mockDeviceRepo.save.mockResolvedValue({ deviceToken: 'generated-uuid' });

    const result = await service.registerAgent({
      inviteToken: 'valid-token',
      hostname: 'DESKTOP-ABC',
      os: 'windows',
    });

    expect(result.employeeId).toBe('user-uuid');
    expect(result.orgId).toBe('org-uuid');
    expect(typeof result.agentToken).toBe('string');
    expect(result.agentToken.length).toBeGreaterThan(10);
  });

  it('throws UnauthorizedException when invite token is invalid', async () => {
    mockTokenService.peek.mockResolvedValue(null);

    await expect(
      service.registerAgent({ inviteToken: 'bad-token' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when user not found', async () => {
    mockTokenService.peek.mockResolvedValue('user-uuid');
    mockUserRepo.findOne.mockResolvedValue(null);

    await expect(
      service.registerAgent({ inviteToken: 'valid-token' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('AgentService.recordHeartbeat', () => {
  let service: AgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        { provide: getRepositoryToken(AgentDevice), useValue: mockDeviceRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(ActivityEvent), useValue: mockActivityRepo },
        { provide: getRepositoryToken(Screenshot), useValue: mockScreenshotRepo },
        { provide: getRepositoryToken(GpsLocation), useValue: mockGpsRepo },
        { provide: getRepositoryToken(Organization), useValue: mockOrgRepo },
        { provide: ConfigService, useValue: mockConfig },
        { provide: 'TOKEN_SERVICE', useValue: mockTokenService },
      ],
    }).compile();
    service = module.get<AgentService>(AgentService);
    jest.clearAllMocks();
  });

  it('updates last_seen_at on heartbeat', async () => {
    mockDeviceRepo.update.mockResolvedValue({ affected: 1 });

    await service.recordHeartbeat(mockUser as any);

    expect(mockDeviceRepo.update).toHaveBeenCalledWith(
      { userId: 'user-uuid', isActive: true },
      expect.objectContaining({ lastSeenAt: expect.any(Date) }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/api && npx jest agent.service.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: FAIL — `service.registerAgent is not a function` (method not yet implemented).

- [ ] **Step 4: Add registerAgent() and recordHeartbeat() to AgentService**

Add these imports at the top of `apps/api/src/modules/agent/agent.service.ts`:
```typescript
import { Injectable, ServiceUnavailableException, UnauthorizedException, Inject, forwardRef, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { TokenService } from '../auth/token.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
```

Add `AgentDevice` to the existing `@InjectRepository` list in the constructor and inject `TokenService`:
```typescript
// In constructor parameters, add:
@InjectRepository(AgentDevice)
private deviceRepo: Repository<AgentDevice>,
@Inject(forwardRef(() => 'TOKEN_SERVICE'))
private tokenService: TokenService,
private readonly logger = new Logger(AgentService.name);
```

Add the two new methods at the bottom of the class (before the closing `}`):
```typescript
async registerAgent(dto: RegisterAgentDto): Promise<{
  agentToken: string;
  employeeId: string;
  orgId: string;
}> {
  const userId = await this.tokenService.peek('invite', dto.inviteToken);
  if (!userId) throw new UnauthorizedException('Invalid or expired invite token');

  const user = await this.userRepo.findOne({ where: { id: userId } });
  if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');

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
```

Note: The `userRepo` field already exists in `AgentService` (added in existing impl) — no change needed. If it doesn't exist add `@InjectRepository(User) private userRepo: Repository<User>` to the constructor. Check the existing constructor params.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/api && npx jest agent.service.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/agent/dto/register-agent.dto.ts \
        apps/api/src/modules/agent/agent.service.ts \
        apps/api/src/modules/agent/agent.service.spec.ts
git commit -m "feat(agent): add registerAgent() and recordHeartbeat() to AgentService"
```

---

## Task 4: Update AgentAuthGuard — Look Up from agent_devices

**Files:**
- Modify: `apps/api/src/modules/agent/agent-auth.guard.ts`
- Create: `apps/api/src/modules/agent/agent-auth.guard.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/agent/agent-auth.guard.spec.ts
import { AgentAuthGuard } from './agent-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

const mockRequest = (token?: string) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  user: undefined as any,
});

const mockCtx = (token?: string) => ({
  switchToHttp: () => ({
    getRequest: () => mockRequest(token),
  }),
}) as unknown as ExecutionContext;

const mockDevice = { userId: 'user-uuid', isActive: true };
const mockUser = { id: 'user-uuid', organizationId: 'org-uuid', isActive: true };

const mockAgentService = {
  findDeviceByToken: jest.fn(),
};
const mockUserRepo = { findOne: jest.fn() };

describe('AgentAuthGuard', () => {
  let guard: AgentAuthGuard;

  beforeEach(() => {
    guard = new AgentAuthGuard(mockAgentService as any, mockUserRepo as any);
    jest.clearAllMocks();
  });

  it('attaches user to request when token is valid', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(mockDevice);
    mockUserRepo.findOne.mockResolvedValue(mockUser);

    const req = mockRequest('valid-token');
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(req.user).toEqual(mockUser);
  });

  it('throws UnauthorizedException when no token provided', async () => {
    await expect(guard.canActivate(mockCtx())).rejects.toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when device not found', async () => {
    mockAgentService.findDeviceByToken.mockResolvedValue(null);
    await expect(guard.canActivate(mockCtx('bad-token'))).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest agent-auth.guard.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: FAIL — constructor signature mismatch (guard currently uses userRepo directly for agentToken lookup).

- [ ] **Step 3: Rewrite agent-auth.guard.ts**

Replace the entire contents of `apps/api/src/modules/agent/agent-auth.guard.ts`:

```typescript
// apps/api/src/modules/agent/agent-auth.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AgentService } from './agent.service';

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    @Inject(forwardRef(() => AgentService))
    private agentService: AgentService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader: string | undefined = request.headers['authorization'];
    const xDeviceToken: string | undefined = request.headers['x-device-token'];
    const raw = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xDeviceToken;

    if (!raw) throw new UnauthorizedException('No device token provided');

    const device = await this.agentService.findDeviceByToken(raw);
    if (!device) throw new UnauthorizedException('Invalid or expired device token');

    const user = await this.userRepo.findOne({ where: { id: device.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');

    request.user = user;
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest agent-auth.guard.spec.ts --no-coverage 2>&1 | tail -20
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/agent/agent-auth.guard.ts \
        apps/api/src/modules/agent/agent-auth.guard.spec.ts
git commit -m "feat(agent): update AgentAuthGuard to use agent_devices table"
```

---

## Task 5: MonitoringGateway (Socket.IO /monitoring namespace)

**Files:**
- Create: `apps/api/src/modules/monitoring/monitoring.gateway.ts`
- Modify: `apps/api/src/modules/monitoring/monitoring.module.ts`

- [ ] **Step 1: Write MonitoringGateway**

```typescript
// apps/api/src/modules/monitoring/monitoring.gateway.ts
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

export interface EmployeeStatusPayload {
  userId: string;
  status: 'online' | 'idle' | 'offline';
  activeApp?: string | null;
  lastSeen: Date;
}

export interface EmployeeScreenshotPayload {
  userId: string;
  screenshotId: string;
  capturedAt: Date;
}

export interface EmployeeActivityPayload {
  userId: string;
  appName: string;
  windowTitle?: string | null;
  timestamp: Date;
}

@WebSocketGateway({ namespace: '/monitoring', cors: true })
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(MonitoringGateway.name);

  private connections = new Map<string, { userId: string; orgId: string }>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }
    try {
      const payload = this.jwtService.verify(token) as { sub: string; orgId: string };
      this.connections.set(client.id, { userId: payload.sub, orgId: payload.orgId });
      client.join(`org:${payload.orgId}`);
      this.logger.debug(`Manager ${payload.sub} connected to monitoring`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connections.delete(client.id);
  }

  emitEmployeeStatus(orgId: string, payload: EmployeeStatusPayload): void {
    this.server.to(`org:${orgId}`).emit('employee:status', payload);
  }

  emitScreenshotTaken(orgId: string, payload: EmployeeScreenshotPayload): void {
    this.server.to(`org:${orgId}`).emit('employee:screenshot', payload);
  }

  emitActivityUpdate(orgId: string, payload: EmployeeActivityPayload): void {
    this.server.to(`org:${orgId}`).emit('employee:activity', payload);
  }
}
```

- [ ] **Step 2: Update MonitoringModule to provide and export MonitoringGateway**

Replace `apps/api/src/modules/monitoring/monitoring.module.ts`:

```typescript
// apps/api/src/modules/monitoring/monitoring.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { MonitoringGateway } from './monitoring.gateway';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEvent, Screenshot, Attendance]),
    AgentModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringGateway],
  exports: [MonitoringGateway],
})
export class MonitoringModule {}
```

- [ ] **Step 3: Start the API and confirm no TypeScript errors**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/monitoring/monitoring.gateway.ts \
        apps/api/src/modules/monitoring/monitoring.module.ts
git commit -m "feat(monitoring): add MonitoringGateway Socket.IO /monitoring namespace"
```

---

## Task 6: AgentRegistrationController + Heartbeat Endpoint

**Files:**
- Create: `apps/api/src/modules/agent/agent-registration.controller.ts`
- Modify: `apps/api/src/modules/agent/agent.controller.ts`
- Modify: `apps/api/src/modules/agent/agent.module.ts`

- [ ] **Step 1: Create AgentRegistrationController**

This controller lives at `@Controller('agent')` (not `agent/sync`) so `POST /agent/register` resolves correctly.

```typescript
// apps/api/src/modules/agent/agent-registration.controller.ts
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { RegisterAgentDto } from './dto/register-agent.dto';

@ApiTags('Agent Registration')
@Controller('agent')
export class AgentRegistrationController {
  constructor(private readonly service: AgentService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register desktop agent device using an invite token' })
  async register(@Body() dto: RegisterAgentDto) {
    const { agentToken, employeeId, orgId } = await this.service.registerAgent(dto);
    return { data: { agentToken, employeeId, orgId } };
  }
}
```

- [ ] **Step 2: Add heartbeat endpoint to AgentController**

In `apps/api/src/modules/agent/agent.controller.ts`, add at the bottom of the class (inside the `@UseGuards(AgentAuthGuard)` class):

```typescript
@Post('heartbeat')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Update agent last_seen_at and emit live status' })
async heartbeat(@AgentCurrentUser() user: User) {
  await this.service.recordHeartbeat(user);
  return { ok: true };
}
```

- [ ] **Step 3: Update AgentModule**

Replace `apps/api/src/modules/agent/agent.module.ts`:

```typescript
// apps/api/src/modules/agent/agent.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentController } from './agent.controller';
import { AgentRegistrationController } from './agent-registration.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { User } from '../../database/entities/user.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEvent,
      Screenshot,
      User,
      GpsLocation,
      Organization,
      AgentDevice,
    ]),
    forwardRef(() => MonitoringModule),
  ],
  controllers: [AgentController, AgentRegistrationController],
  providers: [AgentService, AgentAuthGuard],
  exports: [AgentService],
})
export class AgentModule {}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -30
```
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/agent/agent-registration.controller.ts \
        apps/api/src/modules/agent/agent.controller.ts \
        apps/api/src/modules/agent/agent.module.ts
git commit -m "feat(agent): add /agent/register endpoint and /agent/sync/heartbeat"
```

---

## Task 7: Wire AgentService → MonitoringGateway Emissions

After each sync operation, emit Socket.IO events so manager browsers update in real time.

**Files:**
- Modify: `apps/api/src/modules/agent/agent.service.ts`

- [ ] **Step 1: Inject MonitoringGateway into AgentService**

In `apps/api/src/modules/agent/agent.service.ts`, add the import and inject:

```typescript
import { forwardRef, Inject } from '@nestjs/common';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';
```

In the constructor, add:
```typescript
@Inject(forwardRef(() => MonitoringGateway))
private monitoringGateway: MonitoringGateway,
```

- [ ] **Step 2: Emit after heartbeat**

In `recordHeartbeat()`, add the emit call after the `update`:

```typescript
async recordHeartbeat(user: User): Promise<void> {
  await this.deviceRepo.update(
    { userId: user.id, isActive: true },
    { lastSeenAt: new Date() },
  );
  this.monitoringGateway.emitEmployeeStatus(user.organizationId, {
    userId: user.id,
    status: 'online',
    lastSeen: new Date(),
  });
}
```

- [ ] **Step 3: Emit after saveActivities**

In `saveActivities()`, add at the end (after `return entities.length`):

```typescript
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

  // Emit the most recent activity to monitoring dashboard
  if (entities.length > 0) {
    const latest = entities[entities.length - 1];
    this.monitoringGateway.emitActivityUpdate(user.organizationId, {
      userId: user.id,
      appName: latest.appName,
      windowTitle: latest.windowTitle ?? null,
      timestamp: latest.startedAt,
    });
    this.monitoringGateway.emitEmployeeStatus(user.organizationId, {
      userId: user.id,
      status: 'online',
      lastSeen: latest.startedAt,
      activeApp: latest.appName,
    });
  }

  return entities.length;
}
```

- [ ] **Step 4: Emit after saveScreenshot**

In `saveScreenshot()`, add after `this.screenshotRepo.save(entity)`:

```typescript
async saveScreenshot(user: User, dto: SyncScreenshotDto): Promise<Screenshot> {
  const entity = this.screenshotRepo.create({
    userId: user.id,
    organizationId: user.organizationId,
    s3Key: dto.screenshotKey,
    capturedAt: new Date(dto.capturedAt),
    fileSizeBytes: dto.fileSizeBytes,
  });
  const saved = await this.screenshotRepo.save(entity);

  this.monitoringGateway.emitScreenshotTaken(user.organizationId, {
    userId: user.id,
    screenshotId: saved.id,
    capturedAt: saved.capturedAt,
  });

  return saved;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -30
```
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/agent/agent.service.ts
git commit -m "feat(agent): emit Socket.IO events to MonitoringGateway after sync ops"
```

---

## Task 8: Wire AgentDevice to app.module.ts + TokenService Injection

The `agent_devices` migration must be registered in TypeORM. The `AgentService` needs `TokenService` which lives in `AuthModule`.

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/modules/agent/agent.module.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts` (export TokenService if not already)

- [ ] **Step 1: Add AgentDevice to app.module.ts entity list**

In `apps/api/src/app.module.ts`, add the import and entity:

```typescript
import { AgentDevice } from './database/entities/agent-device.entity';
```

In the `TypeOrmModule.forRootAsync` entities array, add `AgentDevice` alongside the existing entities.

- [ ] **Step 2: Ensure AuthModule exports TokenService**

Open `apps/api/src/modules/auth/auth.module.ts`. If `TokenService` is not in the `exports` array, add it:

```typescript
exports: [TokenService, JwtModule],
```

- [ ] **Step 3: Import AuthModule into AgentModule**

In `apps/api/src/modules/agent/agent.module.ts`, add `AuthModule` to imports (no forwardRef needed — AuthModule does not import AgentModule):

```typescript
import { AuthModule } from '../auth/auth.module';

// In @Module imports array:
imports: [
  TypeOrmModule.forFeature([...]),
  forwardRef(() => MonitoringModule),
  AuthModule,
],
```

- [ ] **Step 4: Update AgentService constructor to use injected TokenService**

In `apps/api/src/modules/agent/agent.service.ts`, replace the `@Inject(forwardRef(() => 'TOKEN_SERVICE'))` with:

```typescript
import { TokenService } from '../auth/token.service';

// In constructor:
private readonly tokenService: TokenService,
```

(No need for `@Inject` decorator — just use normal injection since AuthModule is now imported.)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit 2>&1 | head -40
```
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.module.ts \
        apps/api/src/modules/auth/auth.module.ts \
        apps/api/src/modules/agent/agent.module.ts \
        apps/api/src/modules/agent/agent.service.ts
git commit -m "feat(agent): wire AgentDevice entity, AuthModule, TokenService injection"
```

---

## Task 9: Integration Verification (curl)

No automated E2E test here — manual curl flow to confirm the whole pipeline works end to end. Run after SP1 is also implemented (TokenService must be working).

**Files:** None — verification only.

- [ ] **Step 1: Start the API locally**

Prerequisite: `.env` set up with `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`. No S3 needed for this test.

```bash
cd apps/api && npm run start:dev
```

- [ ] **Step 2: Register a user and get invite token from Redis**

```bash
# Register org + admin
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Admin","lastName":"User","email":"admin@test.com","password":"Password123!","organizationName":"Test Org"}' | jq .

# Invite an employee (uses AuthGuard — need admin JWT first)
# 1. Login as admin:
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Password123!"}' | jq -r '.accessToken')

# 2. Invite employee:
curl -s -X POST http://localhost:3000/users/invite \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"employee@test.com","firstName":"Bob","lastName":"Smith","role":"employee"}' | jq .
```

Expected: `{ "id": "...", "email": "employee@test.com" }`

- [ ] **Step 3: Get the invite token from Redis**

```bash
# In a separate terminal — get the raw invite token from Redis
# (In production the token is emailed; here we grab it directly for testing)
redis-cli KEYS "token:invite:*"
# Copy one key, e.g. token:invite:abc123
redis-cli GET "token:invite:abc123"
# Output: the userId
```

The invite token is the part after `token:invite:` in the key. Use that as `inviteToken` below.

- [ ] **Step 4: Register the agent**

```bash
INVITE_TOKEN="<token-from-step-3>"

AGENT_RESPONSE=$(curl -s -X POST http://localhost:3000/agent/register \
  -H "Content-Type: application/json" \
  -d "{\"inviteToken\":\"$INVITE_TOKEN\",\"hostname\":\"DESKTOP-TEST\",\"os\":\"linux\"}")

echo $AGENT_RESPONSE | jq .
AGENT_TOKEN=$(echo $AGENT_RESPONSE | jq -r '.data.agentToken')
echo "Agent token: $AGENT_TOKEN"
```

Expected:
```json
{
  "data": {
    "agentToken": "<uuid>",
    "employeeId": "<uuid>",
    "orgId": "<uuid>"
  }
}
```

- [ ] **Step 5: Send a heartbeat**

```bash
curl -s -X POST http://localhost:3000/agent/sync/heartbeat \
  -H "Authorization: Bearer $AGENT_TOKEN" | jq .
```

Expected: `{ "ok": true }`

- [ ] **Step 6: Sync activity**

```bash
curl -s -X POST http://localhost:3000/agent/sync/activity \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "appName": "VS Code",
      "windowTitle": "main.go",
      "startedAt": "2026-04-08T10:00:00Z",
      "durationSec": 300,
      "keystrokeCount": 42
    }]
  }' | jq .
```

Expected: `{ "saved": 1 }`

- [ ] **Step 7: Verify invalid token is rejected**

```bash
curl -s -X POST http://localhost:3000/agent/sync/heartbeat \
  -H "Authorization: Bearer bad-token" | jq .
```

Expected: `{ "statusCode": 401, "message": "Invalid or expired device token" }`

- [ ] **Step 8: Commit final**

```bash
git add .
git commit -m "feat(sp2): complete agent sync pipeline — register, heartbeat, real-time monitoring"
```

---

## Self-Review Against Spec

**Spec requirements checked:**

| Requirement | Covered by |
|-------------|-----------|
| `POST /agent/register` — returns device_token | Task 6 (AgentRegistrationController) |
| Agent auth via device_token, not JWT | Task 4 (AgentAuthGuard rewrite) |
| `agent_devices` table | Task 1 + 2 |
| `POST /agent/heartbeat` | Task 6 (added to AgentController) |
| Redis pub/sub after sync | Task 7 (direct Socket.IO emission — same result, simpler) |
| Socket.IO emits `employee:status` on heartbeat | Task 7 (recordHeartbeat emits) |
| Socket.IO emits `employee:activity` on activity sync | Task 7 (saveActivities emits) |
| Socket.IO emits `employee:screenshot` on screenshot sync | Task 7 (saveScreenshot emits) |
| Manager browser joins `org:{orgId}` room via JWT | Task 5 (MonitoringGateway.handleConnection) |
| Invalid device token → 401 | Task 4 (guard) |
| Agent registers with invite token (peek, not consume) | Task 3 (registerAgent uses peek) |

**Placeholder scan:** None found — all steps have complete code.

**Type consistency:**
- `EmployeeStatusPayload.lastSeen: Date` — consistent across Task 5 and Task 7
- `MonitoringGateway.emitEmployeeStatus(orgId, payload)` — consistent in Task 5 definition and Task 7 usage
- `AgentDevice.deviceToken` — consistent between entity (Task 2), guard (Task 4), and service (Task 3)

**Note on Redis pub/sub:** The spec mentions Redis pub/sub as the transport. For a single-server deployment, direct Socket.IO emission is equivalent. When scaling to multiple API servers, wrap the `monitoringGateway.*` calls in Redis pub/sub using `@socket.io/redis-adapter` (already installed). This is a one-line config change in `main.ts` when needed — not required for Phase 1.
