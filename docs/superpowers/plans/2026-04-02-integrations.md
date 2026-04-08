# Integrations & Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow organizations to register outbound webhooks and a Slack incoming webhook so that platform events (clock-in/out, timesheet submitted/approved, task status changed) are automatically delivered to external systems.

**Architecture:** Three new DB tables (`webhook_endpoints`, `webhook_deliveries`, `slack_integrations`) are managed by a single `IntegrationsModule` in NestJS. An `IntegrationsService` handles CRUD for endpoints and the fire-and-forget HTTP delivery loop; a `WebhookDispatcher` helper called from other modules (TimeTracking, Projects) posts events by calling `IntegrationsService.deliverWebhook`. The frontend settings page at `/integrations` uses TanStack Query mutations to manage endpoints and the Slack config.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL, Node.js fetch, Next.js 14, TanStack Query v5, shadcn/ui, Tailwind CSS.

---

## Task 1 — DB Migration + Entities

### 1-A DB Migration

- [ ] Create `apps/api/src/database/migrations/006_integrations_schema.ts`

```typescript
// apps/api/src/database/migrations/006_integrations_schema.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class IntegrationsSchema1743638400006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── webhook_endpoints ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,
        url             VARCHAR(500) NOT NULL,
        secret          VARCHAR(255),
        events          TEXT[] NOT NULL DEFAULT '{}',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org
        ON webhook_endpoints(organization_id);

      ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON webhook_endpoints
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── webhook_deliveries ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        endpoint_id   UUID REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        event_type    VARCHAR(100) NOT NULL,
        payload       JSONB NOT NULL DEFAULT '{}',
        status_code   INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        succeeded     BOOLEAN NOT NULL DEFAULT FALSE,
        delivered_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
        ON webhook_deliveries(endpoint_id, created_at DESC);
    `);

    // ── slack_integrations ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL UNIQUE,
        webhook_url     VARCHAR(500) NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_integrations_org
        ON slack_integrations(organization_id);

      ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON slack_integrations
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_deliveries`);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_endpoints`);
    await queryRunner.query(`DROP TABLE IF EXISTS slack_integrations`);
  }
}
```

### 1-B Entity: WebhookEndpoint

- [ ] Create `apps/api/src/database/entities/webhook-endpoint.entity.ts`

```typescript
// apps/api/src/database/entities/webhook-endpoint.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { WebhookDelivery } from './webhook-delivery.entity';

@Entity('webhook_endpoints')
export class WebhookEndpoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ length: 500 })
  url: string;

  @Column({ length: 255, nullable: true })
  secret: string | null;

  @Column({ type: 'text', array: true, default: [] })
  events: string[];

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => WebhookDelivery, (d) => d.endpoint)
  deliveries: WebhookDelivery[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### 1-C Entity: WebhookDelivery

- [ ] Create `apps/api/src/database/entities/webhook-delivery.entity.ts`

```typescript
// apps/api/src/database/entities/webhook-delivery.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookEndpoint } from './webhook-endpoint.entity';

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'endpoint_id', nullable: true })
  endpointId: string | null;

  @ManyToOne(() => WebhookEndpoint, (e) => e.deliveries, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'endpoint_id' })
  endpoint: WebhookEndpoint | null;

  @Column({ name: 'event_type', length: 100 })
  eventType: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ name: 'status_code', nullable: true })
  statusCode: number | null;

  @Column({ name: 'attempt_count', default: 1 })
  attemptCount: number;

  @Column({ default: false })
  succeeded: boolean;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### 1-D Entity: SlackIntegration

- [ ] Create `apps/api/src/database/entities/slack-integration.entity.ts`

```typescript
// apps/api/src/database/entities/slack-integration.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('slack_integrations')
export class SlackIntegration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', unique: true })
  organizationId: string;

  @Column({ name: 'webhook_url', length: 500 })
  webhookUrl: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

---

## Task 2 — IntegrationsService + Tests (TDD)

### 2-A Service spec (write tests first)

- [ ] Create `apps/api/src/modules/integrations/integrations.service.spec.ts`

```typescript
// apps/api/src/modules/integrations/integrations.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { WebhookEndpoint } from '../../database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '../../database/entities/webhook-delivery.entity';
import { SlackIntegration } from '../../database/entities/slack-integration.entity';

// ── Mock helpers ───────────────────────────────────────────────────────

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  count: jest.Mock;
};

function mockRepo(): MockRepo {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };
}

// ── Global fetch mock ─────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Tests ─────────────────────────────────────────────────────────────

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let endpointRepo: MockRepo;
  let deliveryRepo: MockRepo;
  let slackRepo: MockRepo;

  const ORG = 'org-1';
  const ENDPOINT_ID = 'ep-1';

  beforeEach(async () => {
    endpointRepo = mockRepo();
    deliveryRepo = mockRepo();
    slackRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        { provide: getRepositoryToken(WebhookEndpoint), useValue: endpointRepo },
        { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
        { provide: getRepositoryToken(SlackIntegration), useValue: slackRepo },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    jest.clearAllMocks();
  });

  // ── listEndpoints ──────────────────────────────────────────────────

  describe('listEndpoints', () => {
    it('returns all webhook endpoints for org', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: ENDPOINT_ID, url: 'https://example.com/hook', events: ['clock.in'], isActive: true },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);

      const result = await service.listEndpoints(ORG);

      expect(endpointRepo.find).toHaveBeenCalledWith({
        where: { organizationId: ORG },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://example.com/hook');
    });
  });

  // ── createEndpoint ─────────────────────────────────────────────────

  describe('createEndpoint', () => {
    it('creates and saves a new webhook endpoint', async () => {
      const dto = {
        url: 'https://example.com/hook',
        secret: 'mysecret',
        events: ['clock.in', 'clock.out'],
      };
      const saved = { id: ENDPOINT_ID, organizationId: ORG, ...dto, isActive: true };
      endpointRepo.create.mockReturnValue(saved);
      endpointRepo.save.mockResolvedValue(saved);

      const result = await service.createEndpoint(ORG, dto);

      expect(endpointRepo.create).toHaveBeenCalledWith({
        organizationId: ORG,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        isActive: true,
      });
      expect(endpointRepo.save).toHaveBeenCalledWith(saved);
      expect(result.id).toBe(ENDPOINT_ID);
    });

    it('defaults to empty events array and no secret when not provided', async () => {
      const dto = { url: 'https://example.com/hook' };
      const saved = { id: ENDPOINT_ID, organizationId: ORG, url: dto.url, secret: null, events: [], isActive: true };
      endpointRepo.create.mockReturnValue(saved);
      endpointRepo.save.mockResolvedValue(saved);

      await service.createEndpoint(ORG, dto);

      expect(endpointRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ secret: undefined, events: [] }),
      );
    });
  });

  // ── updateEndpoint ─────────────────────────────────────────────────

  describe('updateEndpoint', () => {
    it('updates fields on existing endpoint', async () => {
      const existing: Partial<WebhookEndpoint> = {
        id: ENDPOINT_ID,
        organizationId: ORG,
        url: 'https://old.com',
        events: ['clock.in'],
        isActive: true,
      };
      endpointRepo.findOne.mockResolvedValue(existing);
      endpointRepo.save.mockResolvedValue({ ...existing, url: 'https://new.com' });

      const result = await service.updateEndpoint(ORG, ENDPOINT_ID, { url: 'https://new.com' });

      expect(endpointRepo.findOne).toHaveBeenCalledWith({
        where: { id: ENDPOINT_ID, organizationId: ORG },
      });
      expect(result.url).toBe('https://new.com');
    });

    it('throws NotFoundException when endpoint does not exist', async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      await expect(service.updateEndpoint(ORG, 'missing-id', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteEndpoint ─────────────────────────────────────────────────

  describe('deleteEndpoint', () => {
    it('deletes endpoint by id + org', async () => {
      endpointRepo.findOne.mockResolvedValue({ id: ENDPOINT_ID, organizationId: ORG });
      endpointRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteEndpoint(ORG, ENDPOINT_ID);

      expect(endpointRepo.delete).toHaveBeenCalledWith({ id: ENDPOINT_ID, organizationId: ORG });
    });

    it('throws NotFoundException when endpoint does not exist', async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteEndpoint(ORG, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getDeliveries ──────────────────────────────────────────────────

  describe('getDeliveries', () => {
    it('returns deliveries for a specific endpoint', async () => {
      endpointRepo.findOne.mockResolvedValue({ id: ENDPOINT_ID, organizationId: ORG });
      const deliveries = [
        { id: 'd-1', endpointId: ENDPOINT_ID, eventType: 'clock.in', succeeded: true },
      ];
      deliveryRepo.find.mockResolvedValue(deliveries);

      const result = await service.getDeliveries(ORG, ENDPOINT_ID);

      expect(deliveryRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpointId: ENDPOINT_ID },
          take: 200,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('throws NotFoundException when endpoint not found in org', async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      await expect(service.getDeliveries(ORG, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── testEndpoint ───────────────────────────────────────────────────

  describe('testEndpoint', () => {
    it('sends a test ping to the endpoint URL', async () => {
      const endpoint: Partial<WebhookEndpoint> = {
        id: ENDPOINT_ID,
        organizationId: ORG,
        url: 'https://example.com/hook',
        secret: null,
        events: ['clock.in'],
        isActive: true,
      };
      endpointRepo.findOne.mockResolvedValue(endpoint);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.testEndpoint(ORG, ENDPOINT_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/hook',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws NotFoundException when endpoint not found in org', async () => {
      endpointRepo.findOne.mockResolvedValue(null);
      await expect(service.testEndpoint(ORG, 'missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ── deliverWebhook ─────────────────────────────────────────────────

  describe('deliverWebhook', () => {
    it('posts to each active endpoint subscribed to the event type', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: 'ep-A', url: 'https://a.example.com/hook', secret: null, events: ['clock.in', 'clock.out'] },
        { id: 'ep-B', url: 'https://b.example.com/hook', secret: 'sig-secret', events: ['clock.in'] },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.deliverWebhook(ORG, 'clock.in', { userId: 'u-1' });

      expect(endpointRepo.find).toHaveBeenCalledWith({
        where: { organizationId: ORG, isActive: true },
      });
      // Both endpoints subscribe to clock.in, so fetch is called twice
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('skips endpoints that do not subscribe to the event type', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: 'ep-A', url: 'https://a.example.com/hook', secret: null, events: ['clock.out'] },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);

      await service.deliverWebhook(ORG, 'clock.in', { userId: 'u-1' });

      // clock.out endpoint does NOT subscribe to clock.in
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('records a delivery entry even when the remote returns an error status', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: 'ep-A', url: 'https://a.example.com/hook', secret: null, events: ['clock.in'] },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);
      mockFetch.mockResolvedValue({ status: 500, ok: false });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.deliverWebhook(ORG, 'clock.in', { userId: 'u-1' });

      expect(deliveryRepo.save).toHaveBeenCalledTimes(1);
      expect(deliveryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ succeeded: false, statusCode: 500 }),
      );
    });

    it('includes X-Webhook-Signature header when secret is set', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: 'ep-A', url: 'https://a.example.com/hook', secret: 'my-secret', events: ['clock.in'] },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.deliverWebhook(ORG, 'clock.in', { userId: 'u-1' });

      const callArgs = mockFetch.mock.calls[0];
      const init = callArgs[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Webhook-Signature']).toMatch(/^sha256=/);
    });

    it('records a failed delivery when fetch throws a network error', async () => {
      const endpoints: Partial<WebhookEndpoint>[] = [
        { id: 'ep-A', url: 'https://a.example.com/hook', secret: null, events: ['clock.in'] },
      ];
      endpointRepo.find.mockResolvedValue(endpoints);
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      // Should not throw — fire and forget
      await expect(service.deliverWebhook(ORG, 'clock.in', {})).resolves.toBeUndefined();

      expect(deliveryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ succeeded: false, statusCode: null }),
      );
    });
  });

  // ── Slack ──────────────────────────────────────────────────────────

  describe('getSlackConfig', () => {
    it('returns masked Slack URL when config exists', async () => {
      slackRepo.findOne.mockResolvedValue({
        id: 's-1',
        organizationId: ORG,
        webhookUrl: 'https://hooks.slack.com/services/T123/B456/secret789',
        isActive: true,
      });

      const result = await service.getSlackConfig(ORG);

      expect(result).not.toBeNull();
      expect(result!.maskedUrl).toContain('****');
      expect(result!.isActive).toBe(true);
    });

    it('returns null when no Slack config is set', async () => {
      slackRepo.findOne.mockResolvedValue(null);
      const result = await service.getSlackConfig(ORG);
      expect(result).toBeNull();
    });
  });

  describe('saveSlackConfig', () => {
    it('creates a new Slack config when none exists', async () => {
      slackRepo.findOne.mockResolvedValue(null);
      const created = { id: 's-1', organizationId: ORG, webhookUrl: 'https://hooks.slack.com/...', isActive: true };
      slackRepo.create.mockReturnValue(created);
      slackRepo.save.mockResolvedValue(created);

      await service.saveSlackConfig(ORG, 'https://hooks.slack.com/...');

      expect(slackRepo.create).toHaveBeenCalledWith({
        organizationId: ORG,
        webhookUrl: 'https://hooks.slack.com/...',
        isActive: true,
      });
      expect(slackRepo.save).toHaveBeenCalled();
    });

    it('updates existing Slack config when one already exists', async () => {
      const existing = { id: 's-1', organizationId: ORG, webhookUrl: 'https://old.slack.com/...', isActive: true };
      slackRepo.findOne.mockResolvedValue(existing);
      slackRepo.save.mockResolvedValue({ ...existing, webhookUrl: 'https://new.slack.com/...' });

      await service.saveSlackConfig(ORG, 'https://new.slack.com/...');

      expect(slackRepo.create).not.toHaveBeenCalled();
      expect(slackRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ webhookUrl: 'https://new.slack.com/...' }),
      );
    });
  });

  describe('deleteSlackConfig', () => {
    it('deletes Slack config for org', async () => {
      slackRepo.findOne.mockResolvedValue({ id: 's-1', organizationId: ORG });
      slackRepo.delete.mockResolvedValue({ affected: 1 });

      await service.deleteSlackConfig(ORG);

      expect(slackRepo.delete).toHaveBeenCalledWith({ organizationId: ORG });
    });

    it('throws NotFoundException when no Slack config exists', async () => {
      slackRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteSlackConfig(ORG)).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendSlackNotification', () => {
    it('posts a message to the Slack webhook URL', async () => {
      slackRepo.findOne.mockResolvedValue({
        id: 's-1',
        organizationId: ORG,
        webhookUrl: 'https://hooks.slack.com/services/T123/B456/secret',
        isActive: true,
      });
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.sendSlackNotification(ORG, 'User Alice clocked in');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T123/B456/secret',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ text: 'User Alice clocked in' }),
        }),
      );
    });

    it('silently returns when Slack config is not set or inactive', async () => {
      slackRepo.findOne.mockResolvedValue(null);
      await expect(service.sendSlackNotification(ORG, 'test')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('testSlack', () => {
    it('throws NotFoundException when no Slack config exists', async () => {
      slackRepo.findOne.mockResolvedValue(null);
      await expect(service.testSlack(ORG)).rejects.toThrow(NotFoundException);
    });

    it('sends a test message to Slack', async () => {
      slackRepo.findOne.mockResolvedValue({
        id: 's-1',
        organizationId: ORG,
        webhookUrl: 'https://hooks.slack.com/services/T123/B456/secret',
        isActive: true,
      });
      mockFetch.mockResolvedValue({ status: 200, ok: true });
      deliveryRepo.create.mockReturnValue({});
      deliveryRepo.save.mockResolvedValue({});

      await service.testSlack(ORG);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T123/B456/secret',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
```

### 2-B Service Implementation

- [ ] Create `apps/api/src/modules/integrations/integrations.service.ts`

```typescript
// apps/api/src/modules/integrations/integrations.service.ts
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { WebhookEndpoint } from '../../database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '../../database/entities/webhook-delivery.entity';
import { SlackIntegration } from '../../database/entities/slack-integration.entity';

export type CreateEndpointDto = {
  url: string;
  secret?: string;
  events?: string[];
};

export type UpdateEndpointDto = {
  url?: string;
  secret?: string | null;
  events?: string[];
  isActive?: boolean;
};

export type SlackConfigView = {
  id: string;
  maskedUrl: string;
  isActive: boolean;
};

// Valid event types for documentation / validation
export const WEBHOOK_EVENTS = [
  'clock.in',
  'clock.out',
  'timesheet.submitted',
  'timesheet.approved',
  'task.status_changed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Mask all but the first 30 chars of a URL */
function maskUrl(url: string): string {
  if (url.length <= 30) return '****';
  return url.slice(0, 30) + '****';
}

/** HMAC-SHA256 signature of the body using the endpoint secret */
function sign(body: string, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(WebhookEndpoint)
    private endpointRepo: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(SlackIntegration)
    private slackRepo: Repository<SlackIntegration>,
  ) {}

  // ── Webhook Endpoint CRUD ────────────────────────────────────────────

  async listEndpoints(organizationId: string): Promise<WebhookEndpoint[]> {
    return this.endpointRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createEndpoint(
    organizationId: string,
    dto: CreateEndpointDto,
  ): Promise<WebhookEndpoint> {
    const endpoint = this.endpointRepo.create({
      organizationId,
      url: dto.url,
      secret: dto.secret,
      events: dto.events ?? [],
      isActive: true,
    });
    return this.endpointRepo.save(endpoint);
  }

  async updateEndpoint(
    organizationId: string,
    endpointId: string,
    dto: UpdateEndpointDto,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.endpointRepo.findOne({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');

    if (dto.url !== undefined) endpoint.url = dto.url;
    if (dto.secret !== undefined) endpoint.secret = dto.secret;
    if (dto.events !== undefined) endpoint.events = dto.events;
    if (dto.isActive !== undefined) endpoint.isActive = dto.isActive;

    return this.endpointRepo.save(endpoint);
  }

  async deleteEndpoint(organizationId: string, endpointId: string): Promise<void> {
    const endpoint = await this.endpointRepo.findOne({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    await this.endpointRepo.delete({ id: endpointId, organizationId });
  }

  async getDeliveries(
    organizationId: string,
    endpointId: string,
  ): Promise<WebhookDelivery[]> {
    const endpoint = await this.endpointRepo.findOne({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');

    return this.deliveryRepo.find({
      where: { endpointId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async testEndpoint(organizationId: string, endpointId: string): Promise<void> {
    const endpoint = await this.endpointRepo.findOne({
      where: { id: endpointId, organizationId },
    });
    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');

    await this._postToEndpoint(endpoint, 'test.ping', {
      message: 'This is a test webhook from Time Champ',
      timestamp: new Date().toISOString(),
    });
  }

  // ── Webhook Delivery ─────────────────────────────────────────────────

  /**
   * Find all active endpoints for the org that subscribe to eventType,
   * then fire-and-forget POST each. Records delivery in webhook_deliveries.
   */
  async deliverWebhook(
    organizationId: string,
    eventType: string,
    payload: object,
  ): Promise<void> {
    const endpoints = await this.endpointRepo.find({
      where: { organizationId, isActive: true },
    });

    const subscribed = endpoints.filter(
      (ep) => ep.events.length === 0 || ep.events.includes(eventType),
    );

    await Promise.all(
      subscribed.map((ep) => this._postToEndpoint(ep, eventType, payload)),
    );
  }

  private async _postToEndpoint(
    endpoint: WebhookEndpoint,
    eventType: string,
    payload: object,
  ): Promise<void> {
    const body = JSON.stringify({
      event: eventType,
      payload,
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'TimeChamp-Webhook/1.0',
    };

    if (endpoint.secret) {
      headers['X-Webhook-Signature'] = sign(body, endpoint.secret);
    }

    let statusCode: number | null = null;
    let succeeded = false;
    const deliveredAt = new Date();

    try {
      const resp = await fetch(endpoint.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      });
      statusCode = resp.status;
      succeeded = resp.ok;
    } catch {
      // Network error, timeout — record failure
    }

    const delivery = this.deliveryRepo.create({
      endpointId: endpoint.id,
      eventType,
      payload: payload as Record<string, unknown>,
      statusCode,
      succeeded,
      deliveredAt: succeeded ? deliveredAt : null,
    });
    await this.deliveryRepo.save(delivery);
  }

  // ── Slack ────────────────────────────────────────────────────────────

  async getSlackConfig(organizationId: string): Promise<SlackConfigView | null> {
    const config = await this.slackRepo.findOne({ where: { organizationId } });
    if (!config) return null;
    return {
      id: config.id,
      maskedUrl: maskUrl(config.webhookUrl),
      isActive: config.isActive,
    };
  }

  async saveSlackConfig(organizationId: string, webhookUrl: string): Promise<SlackConfigView> {
    let config = await this.slackRepo.findOne({ where: { organizationId } });
    if (config) {
      config.webhookUrl = webhookUrl;
      config.isActive = true;
    } else {
      config = this.slackRepo.create({ organizationId, webhookUrl, isActive: true });
    }
    const saved = await this.slackRepo.save(config);
    return {
      id: saved.id,
      maskedUrl: maskUrl(saved.webhookUrl),
      isActive: saved.isActive,
    };
  }

  async deleteSlackConfig(organizationId: string): Promise<void> {
    const config = await this.slackRepo.findOne({ where: { organizationId } });
    if (!config) throw new NotFoundException('Slack integration not configured');
    await this.slackRepo.delete({ organizationId });
  }

  /**
   * Send a plain-text Slack notification.
   * Silently no-ops if Slack is not configured or inactive.
   */
  async sendSlackNotification(organizationId: string, message: string): Promise<void> {
    const config = await this.slackRepo.findOne({ where: { organizationId, isActive: true } });
    if (!config) return;

    const body = JSON.stringify({ text: message });
    let statusCode: number | null = null;
    let succeeded = false;

    try {
      const resp = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5_000),
      });
      statusCode = resp.status;
      succeeded = resp.ok;
    } catch {
      // Network error — swallow, fire and forget
    }

    const delivery = this.deliveryRepo.create({
      endpointId: null,
      eventType: 'slack.notification',
      payload: { message } as Record<string, unknown>,
      statusCode,
      succeeded,
      deliveredAt: succeeded ? new Date() : null,
    });
    await this.deliveryRepo.save(delivery);
  }

  async testSlack(organizationId: string): Promise<void> {
    const config = await this.slackRepo.findOne({ where: { organizationId } });
    if (!config) throw new NotFoundException('Slack integration not configured');

    await this.sendSlackNotification(organizationId, ':wave: This is a test notification from Time Champ!');
  }
}
```

---

## Task 3 — IntegrationsController

- [ ] Create `apps/api/src/modules/integrations/integrations.controller.ts`

```typescript
// apps/api/src/modules/integrations/integrations.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';
import {
  IsUrl,
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { IntegrationsService, WEBHOOK_EVENTS } from './integrations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

// ── DTOs ─────────────────────────────────────────────────────────────

export class CreateWebhookDto {
  @IsUrl({ require_tls: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string;

  @IsOptional()
  @IsArray()
  @IsIn([...WEBHOOK_EVENTS], { each: true })
  events?: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tls: false })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn([...WEBHOOK_EVENTS], { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveSlackDto {
  @IsUrl({ require_tls: false })
  webhookUrl: string;
}

// ── Controller ────────────────────────────────────────────────────────

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  // ── Webhook endpoints ──────────────────────────────────────────────

  @Get('webhooks')
  @ApiOperation({ summary: 'List registered webhook endpoints for the org' })
  listWebhooks(@CurrentUser() user: User) {
    return this.service.listEndpoints(user.organizationId);
  }

  @Post('webhooks')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Register a new webhook endpoint (admin only)' })
  @ApiBody({ type: CreateWebhookDto })
  createWebhook(@CurrentUser() user: User, @Body() dto: CreateWebhookDto) {
    return this.service.createEndpoint(user.organizationId, dto);
  }

  @Patch('webhooks/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a webhook endpoint (admin only)' })
  @ApiBody({ type: UpdateWebhookDto })
  updateWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.service.updateEndpoint(user.organizationId, id, dto);
  }

  @Delete('webhooks/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook endpoint (admin only)' })
  async deleteWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteEndpoint(user.organizationId, id);
  }

  @Post('webhooks/:id/test')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a test ping to the webhook endpoint (admin only)' })
  async testWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.testEndpoint(user.organizationId, id);
  }

  @Get('webhooks/:id/deliveries')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get recent delivery log for a webhook endpoint (admin only)' })
  getDeliveries(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDeliveries(user.organizationId, id);
  }

  // ── Slack ──────────────────────────────────────────────────────────

  @Get('slack')
  @ApiOperation({ summary: 'Get Slack integration config for the org (URL masked)' })
  getSlack(@CurrentUser() user: User) {
    return this.service.getSlackConfig(user.organizationId);
  }

  @Post('slack')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Save / update Slack incoming webhook URL (admin only)' })
  @ApiBody({ type: SaveSlackDto })
  saveSlack(@CurrentUser() user: User, @Body() dto: SaveSlackDto) {
    return this.service.saveSlackConfig(user.organizationId, dto.webhookUrl);
  }

  @Delete('slack')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Slack integration (admin only)' })
  async deleteSlack(@CurrentUser() user: User): Promise<void> {
    await this.service.deleteSlackConfig(user.organizationId);
  }

  @Post('slack/test')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a test message to Slack (admin only)' })
  async testSlack(@CurrentUser() user: User): Promise<void> {
    await this.service.testSlack(user.organizationId);
  }
}
```

---

## Task 4 — IntegrationsModule + AppModule Wiring

### 4-A IntegrationsModule

- [ ] Create `apps/api/src/modules/integrations/integrations.module.ts`

```typescript
// apps/api/src/modules/integrations/integrations.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookEndpoint } from '../../database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '../../database/entities/webhook-delivery.entity';
import { SlackIntegration } from '../../database/entities/slack-integration.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEndpoint, WebhookDelivery, SlackIntegration]),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],   // exported so TimeTracking / Projects can call deliverWebhook
})
export class IntegrationsModule {}
```

### 4-B AppModule wiring

- [ ] Edit `apps/api/src/app.module.ts`

**Add the three new imports at the top of the file (with the other NestJS module imports):**

```typescript
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { WebhookEndpoint } from './database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from './database/entities/webhook-delivery.entity';
import { SlackIntegration } from './database/entities/slack-integration.entity';
```

**In the `TypeOrmModule.forRootAsync` entities array, add the three new entities after `Screenshot`:**

```typescript
WebhookEndpoint,
WebhookDelivery,
SlackIntegration,
```

**In the module `imports` array, add `IntegrationsModule` after `AnalyticsModule`:**

```typescript
AnalyticsModule,
IntegrationsModule,
```

The complete diff for `app.module.ts`:

```diff
+import { IntegrationsModule } from './modules/integrations/integrations.module';
+import { WebhookEndpoint } from './database/entities/webhook-endpoint.entity';
+import { WebhookDelivery } from './database/entities/webhook-delivery.entity';
+import { SlackIntegration } from './database/entities/slack-integration.entity';

 // ... inside TypeOrmModule.forRootAsync entities array ...
         Screenshot,
+        WebhookEndpoint,
+        WebhookDelivery,
+        SlackIntegration,

 // ... inside Module imports array ...
     AnalyticsModule,
+    IntegrationsModule,
```

> **Note:** The plan's prompt states `app.module.ts` ends with `AgentModule, MonitoringModule, AnalyticsModule, ProjectsModule, GpsModule`. The actual current `app.module.ts` ends at `AnalyticsModule`. Add `IntegrationsModule` immediately after `AnalyticsModule` as the last entry.

---

## Task 5 — Frontend Hooks

- [ ] Create `apps/web/hooks/use-integrations.ts`

```typescript
// apps/web/hooks/use-integrations.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type WebhookEndpoint = {
  id: string;
  url: string;
  secret: string | null;
  events: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhookDelivery = {
  id: string;
  endpointId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  attemptCount: number;
  succeeded: boolean;
  deliveredAt: string | null;
  createdAt: string;
};

export type SlackConfig = {
  id: string;
  maskedUrl: string;
  isActive: boolean;
} | null;

export type CreateWebhookInput = {
  url: string;
  secret?: string;
  events?: string[];
};

export type UpdateWebhookInput = {
  url?: string;
  secret?: string | null;
  events?: string[];
  isActive?: boolean;
};

// ── Query Keys ─────────────────────────────────────────────────────────

const KEYS = {
  webhooks: ['integrations', 'webhooks'] as const,
  deliveries: (id: string) => ['integrations', 'webhooks', id, 'deliveries'] as const,
  slack: ['integrations', 'slack'] as const,
};

// ── Webhook hooks ──────────────────────────────────────────────────────

export function useWebhooks() {
  return useQuery({
    queryKey: KEYS.webhooks,
    queryFn: async () => {
      const { data } = await api.get('/integrations/webhooks');
      return data.data as WebhookEndpoint[];
    },
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateWebhookInput) => {
      const { data } = await api.post('/integrations/webhooks', input);
      return data.data as WebhookEndpoint;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint created');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to create webhook';
      toast.error(msg);
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateWebhookInput & { id: string }) => {
      const { data } = await api.patch(`/integrations/webhooks/${id}`, input);
      return data.data as WebhookEndpoint;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint updated');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to update webhook';
      toast.error(msg);
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/integrations/webhooks/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.webhooks });
      toast.success('Webhook endpoint deleted');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to delete webhook';
      toast.error(msg);
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/integrations/webhooks/${id}/test`);
    },
    onSuccess: () => toast.success('Test ping sent'),
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to send test ping';
      toast.error(msg);
    },
  });
}

export function useDeliveries(endpointId: string) {
  return useQuery({
    queryKey: KEYS.deliveries(endpointId),
    queryFn: async () => {
      const { data } = await api.get(`/integrations/webhooks/${endpointId}/deliveries`);
      return data.data as WebhookDelivery[];
    },
    enabled: !!endpointId,
  });
}

// ── Slack hooks ────────────────────────────────────────────────────────

export function useSlackConfig() {
  return useQuery({
    queryKey: KEYS.slack,
    queryFn: async () => {
      const { data } = await api.get('/integrations/slack');
      return data.data as SlackConfig;
    },
  });
}

export function useSaveSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (webhookUrl: string) => {
      const { data } = await api.post('/integrations/slack', { webhookUrl });
      return data.data as NonNullable<SlackConfig>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.slack });
      toast.success('Slack integration saved');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to save Slack config';
      toast.error(msg);
    },
  });
}

export function useDeleteSlack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.delete('/integrations/slack');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.slack });
      toast.success('Slack integration removed');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to remove Slack integration';
      toast.error(msg);
    },
  });
}

export function useTestSlack() {
  return useMutation({
    mutationFn: async () => {
      await api.post('/integrations/slack/test');
    },
    onSuccess: () => toast.success('Test message sent to Slack'),
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? 'Failed to send Slack test';
      toast.error(msg);
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

export const ALL_WEBHOOK_EVENTS = [
  { value: 'clock.in',              label: 'Clock In' },
  { value: 'clock.out',             label: 'Clock Out' },
  { value: 'timesheet.submitted',   label: 'Timesheet Submitted' },
  { value: 'timesheet.approved',    label: 'Timesheet Approved' },
  { value: 'task.status_changed',   label: 'Task Status Changed' },
] as const;
```

---

## Task 6 — Frontend Components + Integrations Page

### 6-A WebhookForm component

- [ ] Create `apps/web/components/integrations/webhook-form.tsx`

```tsx
// apps/web/components/integrations/webhook-form.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ALL_WEBHOOK_EVENTS,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEndpoint,
} from '@/hooks/use-integrations';

type Props = {
  initial?: WebhookEndpoint;
  onSubmit: (data: CreateWebhookInput | UpdateWebhookInput) => void;
  onCancel: () => void;
  isPending: boolean;
};

export function WebhookForm({ initial, onSubmit, onCancel, isPending }: Props) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [secret, setSecret] = useState(initial?.secret ?? '');
  const [events, setEvents] = useState<string[]>(initial?.events ?? []);

  function toggleEvent(value: string) {
    setEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      url: url.trim(),
      secret: secret.trim() || undefined,
      events,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="webhook-url">Endpoint URL</Label>
        <Input
          id="webhook-url"
          type="url"
          placeholder="https://example.com/webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="webhook-secret">
          Secret{' '}
          <span className="text-slate-400 font-normal">(optional — used for HMAC-SHA256 signature)</span>
        </Label>
        <Input
          id="webhook-secret"
          type="password"
          placeholder="Leave blank to skip signing"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoComplete="new-password"
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">
          Events{' '}
          <span className="text-slate-400 font-normal">(leave all unchecked to receive every event)</span>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {ALL_WEBHOOK_EVENTS.map((ev) => (
            <div key={ev.value} className="flex items-center gap-2">
              <Checkbox
                id={`ev-${ev.value}`}
                checked={events.includes(ev.value)}
                onCheckedChange={() => toggleEvent(ev.value)}
              />
              <Label htmlFor={`ev-${ev.value}`} className="font-normal cursor-pointer">
                {ev.label}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={isPending} className="flex-1">
          {isPending ? 'Saving...' : initial ? 'Update Webhook' : 'Create Webhook'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

### 6-B WebhookList component

- [ ] Create `apps/web/components/integrations/webhook-list.tsx`

```tsx
// apps/web/components/integrations/webhook-list.tsx
'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WebhookForm } from './webhook-form';
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useDeliveries,
  type WebhookEndpoint,
} from '@/hooks/use-integrations';

function DeliveryLog({ endpointId, onClose }: { endpointId: string; onClose: () => void }) {
  const { data: deliveries = [], isLoading } = useDeliveries(endpointId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Delivery Log</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
        ) : deliveries.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No deliveries yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Delivered At</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.eventType}</TableCell>
                  <TableCell>
                    <Badge variant={d.succeeded ? 'default' : 'destructive'}>
                      {d.succeeded ? 'OK' : 'Failed'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{d.statusCode ?? '—'}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {d.deliveredAt
                      ? new Date(d.deliveredAt).toLocaleString()
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebhookList() {
  const { data: webhooks = [], isLoading } = useWebhooks();
  const createMutation = useCreateWebhook();
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();
  const testMutation = useTestWebhook();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<WebhookEndpoint | null>(null);
  const [viewingDeliveriesFor, setViewingDeliveriesFor] = useState<string | null>(null);

  function handleCreate(data: any) {
    createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
  }

  function handleUpdate(data: any) {
    if (!editing) return;
    updateMutation.mutate({ id: editing.id, ...data }, { onSuccess: () => setEditing(null) });
  }

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading webhooks...</p>;
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">Webhook Endpoints</h3>
        <Button size="sm" onClick={() => setShowForm(true)}>
          + Add Endpoint
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <WebhookForm
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
            isPending={createMutation.isPending}
          />
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <WebhookForm
            initial={editing}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            isPending={updateMutation.isPending}
          />
        </div>
      )}

      {/* Table */}
      {webhooks.length === 0 && !showForm ? (
        <p className="text-sm text-slate-400 py-4 text-center">
          No webhook endpoints registered yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>URL</TableHead>
              <TableHead>Events</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {webhooks.map((wh) => (
              <TableRow key={wh.id}>
                <TableCell className="font-mono text-xs max-w-xs truncate">
                  {wh.url}
                </TableCell>
                <TableCell>
                  {wh.events.length === 0 ? (
                    <Badge variant="secondary">All events</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {wh.events.map((ev) => (
                        <Badge key={ev} variant="outline" className="text-xs">
                          {ev}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={wh.isActive ? 'default' : 'secondary'}>
                    {wh.isActive ? 'Active' : 'Paused'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setViewingDeliveriesFor(wh.id)}
                    >
                      Log
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={testMutation.isPending}
                      onClick={() => testMutation.mutate(wh.id)}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(wh)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(wh.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Delivery log dialog */}
      {viewingDeliveriesFor && (
        <DeliveryLog
          endpointId={viewingDeliveriesFor}
          onClose={() => setViewingDeliveriesFor(null)}
        />
      )}
    </div>
  );
}
```

### 6-C SlackSection component

- [ ] Create `apps/web/components/integrations/slack-section.tsx`

```tsx
// apps/web/components/integrations/slack-section.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  useSlackConfig,
  useSaveSlack,
  useDeleteSlack,
  useTestSlack,
} from '@/hooks/use-integrations';

export function SlackSection() {
  const { data: config, isLoading } = useSlackConfig();
  const saveMutation = useSaveSlack();
  const deleteMutation = useDeleteSlack();
  const testMutation = useTestSlack();

  const [editing, setEditing] = useState(false);
  const [inputUrl, setInputUrl] = useState('');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    saveMutation.mutate(inputUrl.trim(), {
      onSuccess: () => {
        setEditing(false);
        setInputUrl('');
      },
    });
  }

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading Slack config...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {/* Slack "S" wordmark placeholder */}
        <div className="h-8 w-8 rounded bg-[#4A154B] flex items-center justify-center text-white font-bold text-sm">
          S
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-800">Slack</h3>
          <p className="text-sm text-slate-500">
            Receive notifications in a Slack channel via an Incoming Webhook URL.
          </p>
        </div>
        {config && (
          <Badge className="ml-auto" variant={config.isActive ? 'default' : 'secondary'}>
            {config.isActive ? 'Connected' : 'Inactive'}
          </Badge>
        )}
      </div>

      {/* Current config display */}
      {config && !editing && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">
              Webhook URL
            </span>
            <span className="font-mono text-sm text-slate-700">{config.maskedUrl}</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Update URL
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? 'Sending...' : 'Send Test'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 hover:text-red-700 ml-auto"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </div>
        </div>
      )}

      {/* Add / edit form */}
      {(!config || editing) && (
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="slack-url">Slack Incoming Webhook URL</Label>
            <Input
              id="slack-url"
              type="url"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              required
              className="font-mono text-sm"
            />
            <p className="text-xs text-slate-500">
              Create an Incoming Webhook in your Slack App settings and paste the URL here.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
            {editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setInputUrl('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
```

### 6-D Integrations page

- [ ] Create `apps/web/app/(dashboard)/integrations/page.tsx`

```tsx
// apps/web/app/(dashboard)/integrations/page.tsx
'use client';

import { useSession } from 'next-auth/react';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SlackSection } from '@/components/integrations/slack-section';
import { WebhookList } from '@/components/integrations/webhook-list';

export default function IntegrationsPage() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <>
        <Header title="Integrations" />
        <div className="p-6 text-slate-400 text-sm">Loading...</div>
      </>
    );
  }

  const isAdmin = session?.user?.role === 'admin';

  return (
    <>
      <Header title="Integrations" />
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Info banner for non-admins */}
        {!isAdmin && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Integration settings can only be managed by organization admins.
          </div>
        )}

        {/* Slack */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Messaging</CardTitle>
          </CardHeader>
          <CardContent>
            <SlackSection />
          </CardContent>
        </Card>

        {/* Webhooks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Outbound Webhooks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-500">
              Register URLs to receive HTTP POST notifications when events occur in your
              organization. Optionally add a secret to verify requests with HMAC-SHA256.
            </p>
            <WebhookList />
          </CardContent>
        </Card>

        {/* Supported events reference */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supported Events</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="text-sm w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-4 font-medium text-slate-700">Event</th>
                  <th className="text-left py-2 font-medium text-slate-700">Triggered when</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {[
                  { event: 'clock.in',            when: 'An employee clocks in' },
                  { event: 'clock.out',           when: 'An employee clocks out' },
                  { event: 'timesheet.submitted', when: 'An employee submits a timesheet for approval' },
                  { event: 'timesheet.approved',  when: 'A manager approves a timesheet' },
                  { event: 'task.status_changed', when: 'A task is moved to a new status' },
                ].map(({ event, when }) => (
                  <tr key={event}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700">{event}</td>
                    <td className="py-2 text-slate-500">{when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

---

## Summary Checklist

```
Backend
- [ ] apps/api/src/database/migrations/006_integrations_schema.ts
- [ ] apps/api/src/database/entities/webhook-endpoint.entity.ts
- [ ] apps/api/src/database/entities/webhook-delivery.entity.ts
- [ ] apps/api/src/database/entities/slack-integration.entity.ts
- [ ] apps/api/src/modules/integrations/integrations.service.spec.ts
- [ ] apps/api/src/modules/integrations/integrations.service.ts
- [ ] apps/api/src/modules/integrations/integrations.controller.ts
- [ ] apps/api/src/modules/integrations/integrations.module.ts
- [ ] apps/api/src/app.module.ts  (add imports + entities + IntegrationsModule)

Frontend
- [ ] apps/web/hooks/use-integrations.ts
- [ ] apps/web/components/integrations/webhook-form.tsx
- [ ] apps/web/components/integrations/webhook-list.tsx
- [ ] apps/web/components/integrations/slack-section.tsx
- [ ] apps/web/app/(dashboard)/integrations/page.tsx
```

## Key Design Decisions

1. **Fire and forget delivery** — `deliverWebhook` and `sendSlackNotification` swallow network errors after recording a failed delivery row. No retry queue in MVP; this keeps the service simple and avoids blocking the request cycle in calling modules.

2. **HMAC-SHA256 signing** — Uses Node.js built-in `crypto.createHmac`. Signature is `sha256=<hex>` in the `X-Webhook-Signature` header, matching the GitHub webhook convention for easy adoption by consumers.

3. **AbortSignal.timeout(5_000)** — Native Node 18+ API; no extra dependency. Prevents a slow target from tying up the event loop indefinitely.

4. **Slack as a separate table** — `slack_integrations` has a UNIQUE constraint on `organization_id` (one Slack workspace per org). Keeping it separate from `webhook_endpoints` avoids a sentinel-row anti-pattern and makes the Slack-specific masked-URL response cleaner.

5. **Empty events array = subscribe to all** — An endpoint with `events = []` receives every event type. This is documented in the frontend form and matches the common convention for webhook services.

6. **IntegrationsModule exports IntegrationsService** — Other modules (TimeTracking, Projects) can inject `IntegrationsService` and call `deliverWebhook` / `sendSlackNotification` without circular imports, because those modules import `IntegrationsModule`.

7. **Delivery log capped at 200 per endpoint** — The query uses `take: 200` ordered by `created_at DESC`. A cron job to purge older rows can be added post-MVP; for now the DB will grow slowly.

8. **Secret stored as plain text** — Acceptable for MVP. Post-MVP, encrypt with AES-256 using a KMS key before persisting; the service would decrypt at delivery time.
