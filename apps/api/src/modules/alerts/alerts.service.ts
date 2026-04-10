// apps/api/src/modules/alerts/alerts.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertRule, AlertType } from '../../database/entities/alert-rule.entity';
import { AlertEvent } from '../../database/entities/alert-event.entity';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { MonitoringGateway } from '../monitoring/monitoring.gateway';

// ── DTOs ─────────────────────────────────────────────────────────────────

export type CreateAlertRuleDto = {
  name: string;
  type: AlertType;
  threshold?: number;
  enabled?: boolean;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
};

export type UpdateAlertRuleDto = {
  name?: string;
  type?: AlertType;
  threshold?: number;
  enabled?: boolean;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
};

// ── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertRule)
    private ruleRepo: Repository<AlertRule>,
    @InjectRepository(AlertEvent)
    private eventRepo: Repository<AlertEvent>,
    private readonly mailer: MailerService,
    private readonly gateway: MonitoringGateway,
  ) {}

  // ── Rules API ─────────────────────────────────────────────────────────

  async getRules(organizationId: string): Promise<AlertRule[]> {
    return this.ruleRepo.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createRule(
    organizationId: string,
    dto: CreateAlertRuleDto,
  ): Promise<AlertRule> {
    const rule = this.ruleRepo.create({
      organizationId,
      name: dto.name,
      type: dto.type,
      threshold: dto.threshold ?? 30,
      enabled: dto.enabled ?? true,
      notifyEmail: dto.notifyEmail ?? true,
      notifyInApp: dto.notifyInApp ?? true,
    });
    return this.ruleRepo.save(rule);
  }

  async updateRule(
    id: string,
    organizationId: string,
    dto: UpdateAlertRuleDto,
  ): Promise<AlertRule> {
    const rule = await this.ruleRepo.findOne({ where: { id, organizationId } });
    if (!rule) throw new NotFoundException('Alert rule not found');

    if (dto.name        !== undefined) rule.name        = dto.name;
    if (dto.type        !== undefined) rule.type        = dto.type;
    if (dto.threshold   !== undefined) rule.threshold   = dto.threshold;
    if (dto.enabled     !== undefined) rule.enabled     = dto.enabled;
    if (dto.notifyEmail !== undefined) rule.notifyEmail = dto.notifyEmail;
    if (dto.notifyInApp !== undefined) rule.notifyInApp = dto.notifyInApp;

    return this.ruleRepo.save(rule);
  }

  async deleteRule(id: string, organizationId: string): Promise<void> {
    const rule = await this.ruleRepo.findOne({ where: { id, organizationId } });
    if (!rule) throw new NotFoundException('Alert rule not found');
    await this.ruleRepo.delete({ id, organizationId });
  }

  // ── Events API ────────────────────────────────────────────────────────

  async getEvents(
    organizationId: string,
    userId?: string,
    limit = 50,
  ): Promise<AlertEvent[]> {
    const where: Record<string, unknown> = { organizationId };
    if (userId) where['userId'] = userId;

    return this.eventRepo.find({
      where,
      order: { triggeredAt: 'DESC' },
      take: limit,
      relations: ['rule'],
    });
  }

  async markSeen(id: string, organizationId: string): Promise<AlertEvent> {
    const event = await this.eventRepo.findOne({ where: { id, organizationId } });
    if (!event) throw new NotFoundException('Alert event not found');

    if (!event.seenAt) {
      event.seenAt = new Date();
      return this.eventRepo.save(event);
    }
    return event;
  }

  async getUnreadCount(organizationId: string, userId: string): Promise<number> {
    return this.eventRepo.count({
      where: { organizationId, userId, seenAt: IsNull() },
    });
  }

  // ── Fire Alert (internal) ─────────────────────────────────────────────

  /**
   * Creates an alert_event row, optionally sends email, optionally emits WS.
   * Called by scheduled checkers and can be called by external services.
   */
  async fireAlert(
    rule: AlertRule,
    userId: string,
    message: string,
    employeeEmail: string,
    employeeName: string,
  ): Promise<AlertEvent> {
    const event = this.eventRepo.create({
      organizationId: rule.organizationId,
      userId,
      ruleId: rule.id,
      type: rule.type,
      message,
      triggeredAt: new Date(),
    });
    const saved = await this.eventRepo.save(event);

    if (rule.notifyEmail) {
      await this.mailer.sendAlertEmail(employeeEmail, rule.name, message, employeeName).catch((err: Error) =>
        this.logger.error(`sendAlertEmail failed: ${err.message}`),
      );
    }

    if (rule.notifyInApp) {
      this.gateway.emitAlertNew(rule.organizationId, {
        eventId: saved.id,
        ruleId: rule.id,
        ruleName: rule.name,
        type: rule.type,
        userId,
        message,
        triggeredAt: saved.triggeredAt,
      });
    }

    this.logger.log(`Alert fired — rule "${rule.name}" for user ${userId}`);
    return saved;
  }

  // ── Scheduled Checkers ────────────────────────────────────────────────

  /**
   * Every 5 minutes: check each org's idle_too_long rules.
   * Full data query requires injecting Attendance + ActivityEvent repos or DataSource.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkIdleAlerts(): Promise<void> {
    this.logger.debug('checkIdleAlerts: running idle check across all orgs');
    try {
      const rules = await this.ruleRepo.find({
        where: { type: AlertType.IDLE_TOO_LONG, enabled: true },
      });
      if (rules.length === 0) return;
      this.logger.debug(`checkIdleAlerts: ${rules.length} active idle rules found`);
    } catch (err: unknown) {
      this.logger.error(`checkIdleAlerts failed: ${(err as Error).message}`);
    }
  }

  /**
   * Every day at 20:30 (8:30 PM): check overtime rules.
   */
  @Cron('30 20 * * *')
  async checkOvertimeAlerts(): Promise<void> {
    this.logger.debug('checkOvertimeAlerts: running overtime check');
    try {
      const rules = await this.ruleRepo.find({
        where: { type: AlertType.OVERTIME, enabled: true },
      });
      if (rules.length === 0) return;
      this.logger.debug(`checkOvertimeAlerts: ${rules.length} active overtime rules`);
    } catch (err: unknown) {
      this.logger.error(`checkOvertimeAlerts failed: ${(err as Error).message}`);
    }
  }

  /**
   * Every day at 10:00 AM: check late_clock_in rules.
   */
  @Cron('0 10 * * *')
  async checkLateClockIn(): Promise<void> {
    this.logger.debug('checkLateClockIn: running late clock-in check');
    try {
      const rules = await this.ruleRepo.find({
        where: { type: AlertType.LATE_CLOCK_IN, enabled: true },
      });
      if (rules.length === 0) return;
      this.logger.debug(`checkLateClockIn: ${rules.length} active late clock-in rules`);
    } catch (err: unknown) {
      this.logger.error(`checkLateClockIn failed: ${(err as Error).message}`);
    }
  }
}
