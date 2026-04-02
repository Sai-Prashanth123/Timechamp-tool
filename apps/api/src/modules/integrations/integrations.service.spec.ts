import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
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
  } as unknown as MockRepo;
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
