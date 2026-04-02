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
