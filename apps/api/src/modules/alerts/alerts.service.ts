import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertRule } from '../../database/entities/alert-rule.entity';
import { AlertEvent } from '../../database/entities/alert-event.entity';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertRule) private rulesRepo: Repository<AlertRule>,
    @InjectRepository(AlertEvent) private eventsRepo: Repository<AlertEvent>,
  ) {}

  async getRules(organizationId: string): Promise<AlertRule[]> {
    return this.rulesRepo.find({ where: { organizationId }, order: { createdAt: 'DESC' } });
  }

  async createRule(organizationId: string, dto: {
    name: string; type: string; threshold: number;
    notifyEmail?: boolean; notifyInApp?: boolean;
  }): Promise<AlertRule> {
    const rule = this.rulesRepo.create({ organizationId, ...dto });
    return this.rulesRepo.save(rule);
  }

  async updateRule(id: string, dto: Partial<{ name: string; threshold: number; enabled: boolean; notifyEmail: boolean; notifyInApp: boolean }>): Promise<void> {
    await this.rulesRepo.update(id, dto);
  }

  async deleteRule(id: string): Promise<void> {
    await this.rulesRepo.delete(id);
  }

  async fireAlert(organizationId: string, userId: string, type: string, message: string, ruleId?: string): Promise<AlertEvent> {
    const event = this.eventsRepo.create({ organizationId, userId, type, message, ruleId: ruleId ?? null });
    return this.eventsRepo.save(event);
  }

  async getEvents(organizationId: string, userId?: string, limit = 50): Promise<AlertEvent[]> {
    const where: any = { organizationId };
    if (userId) where.userId = userId;
    return this.eventsRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      relations: ['user'],
    });
  }

  async markSeen(id: string): Promise<void> {
    await this.eventsRepo.update(id, { seenAt: new Date() });
  }

  async getUnreadCount(organizationId: string, userId?: string): Promise<number> {
    const where: any = { organizationId, seenAt: IsNull() };
    if (userId) where.userId = userId;
    return this.eventsRepo.count({ where });
  }

  // ---------------------------------------------------------------------------
  // Scheduled jobs — framework in place; data queries wired once
  // MonitoringSession / ActivityEvent repositories are available in sp8.
  // ---------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkIdleTooLong(): Promise<void> {
    // TODO: inject MonitoringSession repository and query last-activity timestamps.
    // For each enabled IDLE_TOO_LONG rule, find users whose last activity
    // exceeds rule.threshold minutes and call this.fireAlert().
    this.logger.debug('checkIdleTooLong: scheduler registered — data query not yet wired');
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkOvertime(): Promise<void> {
    // TODO: inject MonitoringSession repository and sum today's active minutes per user.
    // For each enabled OVERTIME rule, find users who have worked > rule.threshold
    // minutes today and call this.fireAlert().
    this.logger.debug('checkOvertime: scheduler registered — data query not yet wired');
  }

  @Cron('30 9 * * *') // 9:30 AM daily
  async checkLateClockIn(): Promise<void> {
    // TODO: inject MonitoringSession repository and check for a session start today.
    // For each enabled LATE_CLOCK_IN rule, find users who have no session today
    // and call this.fireAlert().
    this.logger.debug('checkLateClockIn: scheduler registered — data query not yet wired');
  }
}
