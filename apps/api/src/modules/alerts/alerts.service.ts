import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertRule } from './alert-rule.entity';
import { AlertEvent } from './alert-event.entity';

export type CreateAlertRuleDto = {
  name: string;
  metric: string;
  thresholdMinutes?: number;
  isActive?: boolean;
};

export type UpdateAlertRuleDto = {
  name?: string;
  metric?: string;
  thresholdMinutes?: number;
  isActive?: boolean;
};

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(AlertRule)
    private ruleRepo: Repository<AlertRule>,
    @InjectRepository(AlertEvent)
    private eventRepo: Repository<AlertEvent>,
  ) {}

  async listRules(organizationId: string): Promise<AlertRule[]> {
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
      metric: dto.metric,
      thresholdMinutes: dto.thresholdMinutes ?? 30,
      isActive: dto.isActive ?? true,
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

    if (dto.name !== undefined) rule.name = dto.name;
    if (dto.metric !== undefined) rule.metric = dto.metric;
    if (dto.thresholdMinutes !== undefined) rule.thresholdMinutes = dto.thresholdMinutes;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;

    return this.ruleRepo.save(rule);
  }

  async deleteRule(id: string, organizationId: string): Promise<void> {
    const rule = await this.ruleRepo.findOne({ where: { id, organizationId } });
    if (!rule) throw new NotFoundException('Alert rule not found');
    await this.ruleRepo.delete({ id, organizationId });
  }

  async listEvents(organizationId: string, limit = 50): Promise<AlertEvent[]> {
    return this.eventRepo.find({
      where: { organizationId },
      order: { triggeredAt: 'DESC' },
      take: limit,
    });
  }

  async acknowledgeEvent(
    id: string,
    organizationId: string,
    userId: string,
  ): Promise<AlertEvent> {
    const event = await this.eventRepo.findOne({ where: { id, organizationId } });
    if (!event) throw new NotFoundException('Alert event not found');

    event.acknowledgedAt = new Date();
    event.acknowledgedBy = userId;

    return this.eventRepo.save(event);
  }
}
