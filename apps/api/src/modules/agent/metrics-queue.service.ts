import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * MetricsQueueService — pgmq wrapper for the agent_metrics queue.
 *
 * Same pattern as ActivityQueueService — kept as a separate class so each
 * queue's payload type is explicit and the worker code is statically typed.
 * The trade is a tiny bit of duplication (~80 LOC × 3 queues) for clearer
 * call sites and easier debugging.
 */
@Injectable()
export class MetricsQueueService {
  private static readonly QUEUE_NAME = 'agent_metrics';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async enqueue(payload: MetricsQueuePayload): Promise<number> {
    const result = await this.dataSource.query<Array<{ send: number }>>(
      `SELECT pgmq.send($1, $2::jsonb) AS send`,
      [MetricsQueueService.QUEUE_NAME, JSON.stringify(payload)],
    );
    return result[0]?.send ?? 0;
  }

  async read(batchSize: number, visibilityTimeoutSec = 30): Promise<MetricsQueueMessage[]> {
    return this.dataSource.query<MetricsQueueMessage[]>(
      `SELECT msg_id, message FROM pgmq.read($1, $2, $3)`,
      [MetricsQueueService.QUEUE_NAME, visibilityTimeoutSec, batchSize],
    );
  }

  async deleteMany(msgIds: number[]): Promise<void> {
    if (msgIds.length === 0) return;
    await this.dataSource.query(
      `SELECT pgmq.delete($1, $2::bigint[])`,
      [MetricsQueueService.QUEUE_NAME, msgIds],
    );
  }

  async depth(): Promise<number> {
    const result = await this.dataSource.query<Array<{ queue_length: string }>>(
      `SELECT queue_length FROM pgmq.metrics($1)`,
      [MetricsQueueService.QUEUE_NAME],
    );
    return parseInt(result[0]?.queue_length ?? '0', 10);
  }
}

/**
 * Wire format of an enqueued metrics batch. The userId/orgId come from the
 * authenticated agent guard and override anything the agent might claim in
 * the original DTO body — preserves the IDOR fix from Round 5 / R5.2.
 */
export interface MetricsQueuePayload {
  userId: string;
  organizationId: string;
  events: Array<{
    cpuPercent: number;
    memUsedMb: number;
    memTotalMb: number;
    agentCpuPercent: number;
    agentMemMb: number;
    recordedAt: string;
  }>;
}

export interface MetricsQueueMessage {
  msg_id: number;
  message: MetricsQueuePayload;
}
