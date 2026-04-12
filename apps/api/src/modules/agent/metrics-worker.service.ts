import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentMetric } from '../../database/entities/agent-metric.entity';
import { MetricsQueueService } from './metrics-queue.service';

/**
 * MetricsWorkerService — drains the agent_metrics pgmq queue and bulk-inserts.
 *
 * Runs every 5 seconds (slower than activity drain because metrics are
 * lower-volume — agents emit ~1 metric event per 60s vs ~1 activity event
 * per 30s, and per-event size is similar).
 */
@Injectable()
export class MetricsWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(MetricsWorkerService.name);
  private static readonly BATCH_SIZE = 200;
  private static readonly VISIBILITY_TIMEOUT_SEC = 30;
  private flushing = false;

  constructor(
    private readonly queue: MetricsQueueService,
    @InjectRepository(AgentMetric)
    private readonly metricsRepo: Repository<AgentMetric>,
  ) {}

  // Every 5 seconds. NOTE: avoid the literal cron expression inside JSDoc
  // because TypeScript parses asterisk-slash as comment terminator.
  @Cron('*/5 * * * * *')
  async drain(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const messages = await this.queue.read(
        MetricsWorkerService.BATCH_SIZE,
        MetricsWorkerService.VISIBILITY_TIMEOUT_SEC,
      );
      if (messages.length === 0) return;

      const allEntities: AgentMetric[] = [];
      for (const msg of messages) {
        const payload = msg.message;
        for (const e of payload.events ?? []) {
          allEntities.push(
            this.metricsRepo.create({
              employeeId: payload.userId,
              orgId: payload.organizationId,
              cpuPercent: e.cpuPercent,
              memUsedMb: e.memUsedMb,
              memTotalMb: e.memTotalMb,
              agentCpuPercent: e.agentCpuPercent,
              agentMemMb: e.agentMemMb,
              recordedAt: new Date(e.recordedAt),
            }),
          );
        }
      }

      await this.metricsRepo.save(allEntities, { chunk: 500 });
      await this.queue.deleteMany(messages.map((m) => m.msg_id));

      this.logger.debug(
        `Drained ${messages.length} metric messages → inserted ${allEntities.length} rows`,
      );
    } catch (err) {
      this.logger.error(`Metrics drain failed: ${err}`);
    } finally {
      this.flushing = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.flushing) {
      await Promise.race([
        this.drain(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }
}
