import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

export interface AuditActor {
  id: string | null;
  email: string;
}

export interface GetLogsFilters {
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async log(
    organizationId: string,
    actor: AuditActor,
    action: string,
    resourceType: string,
    resourceId?: string | null,
    metadata?: Record<string, unknown> | null,
    ipAddress?: string | null,
  ): Promise<void> {
    const entry = this.repo.create({
      organizationId,
      actorId: actor.id ?? null,
      actorEmail: actor.email,
      action,
      resourceType,
      resourceId: resourceId ?? null,
      metadata: metadata ?? null,
      ipAddress: ipAddress ?? null,
    });
    await this.repo.save(entry);
  }

  async getLogs(
    organizationId: string,
    filters: GetLogsFilters,
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const qb = this.repo
      .createQueryBuilder('al')
      .where('al.organizationId = :orgId', { orgId: organizationId })
      .orderBy('al.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters.actorId) {
      qb.andWhere('al.actorId = :actorId', { actorId: filters.actorId });
    }
    if (filters.action) {
      qb.andWhere('al.action = :action', { action: filters.action });
    }
    if (filters.from) {
      qb.andWhere('al.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('al.createdAt <= :to', { to: filters.to });
    }

    const [logs, total] = await qb.getManyAndCount();
    return { logs, total };
  }
}
