import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * ActivityQueueService — thin wrapper around the `pgmq` Postgres queue extension.
 *
 * Why pgmq instead of a Redis queue / RabbitMQ / SQS?
 * - Zero new infrastructure. The queue lives in the same Supabase Postgres
 *   we already use for everything else. No new account, no new service, no
 *   new bill, no new failure mode.
 * - ACID. A pgmq.send() and a related row insert can be in the same Postgres
 *   transaction. If the API restarts mid-request, the queue state is consistent.
 * - Simple. ~20 lines of TypeScript wrap the entire queue API.
 *
 * Why queue activity at all?
 * - Without queueing: agent POSTs a 100-row activity batch → API does a
 *   bulk INSERT INTO activity_events synchronously → if Supabase is in a
 *   slow window (cold pool, lock contention, network blip) the request
 *   takes 10-30 seconds → agent's 60s HTTP timeout fires → circuit opens.
 * - With queueing: API does ONE small INSERT into pgmq_q_agent_activity
 *   (a single jsonb row) and ACKs in <50ms regardless of how slow the real
 *   activity_events table is. The ActivityWorkerService drains the queue
 *   every 2s in the background; if it falls behind, the queue grows but
 *   the agent never sees a timeout.
 *
 * Throughput: pgmq is benchmarked at ~3K msg/sec on a small Supabase tier
 * and ~30K msg/sec on a large one. At 100K agents posting batches every 30s,
 * peak is ~3.3K msg/sec — comfortably within budget.
 */
@Injectable()
export class ActivityQueueService {
  private readonly logger = new Logger(ActivityQueueService.name);
  private static readonly QUEUE_NAME = 'agent_activity';

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Enqueue an activity batch. The payload is a JSON document containing the
   * full sync request — userId, organizationId, and the events array. The
   * worker will deserialize and bulk-insert.
   *
   * Returns the message ID assigned by pgmq, primarily for observability.
   */
  async enqueue(payload: ActivityQueuePayload): Promise<number> {
    const result = await this.dataSource.query<Array<{ send: number }>>(
      `SELECT pgmq.send($1, $2::jsonb) AS send`,
      [ActivityQueueService.QUEUE_NAME, JSON.stringify(payload)],
    );
    return result[0]?.send ?? 0;
  }

  /**
   * Read up to `batchSize` messages from the queue with a `vt` (visibility
   * timeout) — pgmq hides them from other readers for that many seconds, so
   * we can process and delete them without a second worker grabbing the same
   * batch. If the worker crashes mid-batch, the messages reappear after `vt`
   * expires and another worker (or the next tick) picks them up.
   */
  async read(batchSize: number, visibilityTimeoutSec = 30): Promise<ActivityQueueMessage[]> {
    return this.dataSource.query<ActivityQueueMessage[]>(
      `SELECT msg_id, message FROM pgmq.read($1, $2, $3)`,
      [ActivityQueueService.QUEUE_NAME, visibilityTimeoutSec, batchSize],
    );
  }

  /**
   * Permanently delete a successfully-processed message. The worker calls
   * this only after its bulk INSERT has succeeded — so a worker crash
   * before delete causes a retry, never data loss.
   */
  async delete(msgId: number): Promise<void> {
    await this.dataSource.query(
      `SELECT pgmq.delete($1, $2)`,
      [ActivityQueueService.QUEUE_NAME, msgId],
    );
  }

  /**
   * Bulk delete (used by the worker after a successful batch flush).
   */
  async deleteMany(msgIds: number[]): Promise<void> {
    if (msgIds.length === 0) return;
    await this.dataSource.query(
      `SELECT pgmq.delete($1, $2::bigint[])`,
      [ActivityQueueService.QUEUE_NAME, msgIds],
    );
  }

  /**
   * Current queue depth — handy for the /health endpoint and monitoring.
   * Counts unread messages (the worker has not yet picked them up).
   */
  async depth(): Promise<number> {
    const result = await this.dataSource.query<Array<{ queue_length: string }>>(
      `SELECT queue_length FROM pgmq.metrics($1)`,
      [ActivityQueueService.QUEUE_NAME],
    );
    return parseInt(result[0]?.queue_length ?? '0', 10);
  }
}

/**
 * Wire format of an enqueued activity batch. Mirrors what AgentService used
 * to write directly into activity_events but without converting to TypeORM
 * entities (the worker does that on the way out).
 *
 * `deviceId` is top-level (not per-event) because a single sync request is
 * always from one device — there's no reason to repeat it N times. Nullable
 * for the transition window: requests that came in before the deploy or
 * from agents that haven't picked up the v2 auth cache entry won't have it.
 */
export interface ActivityQueuePayload {
  userId: string;
  organizationId: string;
  deviceId?: string | null;
  events: Array<{
    appName: string;
    windowTitle?: string | null;
    startedAt: string; // ISO timestamp
    durationSec?: number;
    durationMs?: number;
    keystrokeCount?: number;
  }>;
}

export interface ActivityQueueMessage {
  msg_id: number;
  message: ActivityQueuePayload;
}
