import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { ActivityQueueService } from './activity-queue.service';

/**
 * ActivityWorkerService — drains the pgmq agent_activity queue and
 * bulk-inserts events into the activity_events table.
 *
 * Runs every 2 seconds via @Cron. Each tick reads up to BATCH_SIZE messages
 * with a visibility timeout, processes them, and deletes them on success.
 * If the bulk insert fails (e.g. transient Supabase write error), we DO NOT
 * delete the messages — the visibility timeout expires after 30s and the
 * next worker tick picks them up automatically. No data loss, automatic
 * retry, no dead-letter handling needed for the simple cases.
 *
 * Why this is faster end-to-end than synchronous inserts:
 *  1. The agent gets a fast ACK regardless of Supabase write speed.
 *  2. The worker can flatten many small batches into one large insert,
 *     amortizing per-statement overhead.
 *  3. Slow Supabase windows just grow the queue depth — no client timeouts,
 *     no circuit-breaker cascades, no agent restarts needed.
 *
 * Trade-off: rows arrive in activity_events ~2-4 seconds after the agent
 * submitted them (worst case = 1 tick + 1 batch processing time). This is
 * fine for a monitoring system — dashboards refetch on a 30s timer anyway.
 */
@Injectable()
export class ActivityWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(ActivityWorkerService.name);

  // Number of messages to read per tick. Sized so a healthy worker drains
  // the queue faster than the agent fleet can fill it: at 100K agents
  // submitting one batch every 30s = 3,300 msg/sec, so 200 msgs/2s tick
  // = 100 msg/sec per worker. Run multiple worker instances in production
  // for higher throughput.
  private static readonly BATCH_SIZE = 200;

  // pgmq visibility timeout. The window during which the message is hidden
  // from other readers while we process it. Must be longer than the
  // worst-case batch processing time to avoid double-processing.
  private static readonly VISIBILITY_TIMEOUT_SEC = 30;

  // Set to true while a flush is in progress. Prevents two ticks from
  // overlapping if a single batch ever takes longer than the cron interval.
  private flushing = false;

  constructor(
    private readonly queue: ActivityQueueService,
    @InjectRepository(ActivityEvent)
    private readonly activityRepo: Repository<ActivityEvent>,
  ) {}

  // Drain a batch from the queue every 2 seconds. The actual cadence is
  // adaptive: if the queue is empty, the next tick is a no-op (~1ms).
  // If the queue has messages, we process them and let the next tick fire.
  //
  // @nestjs/schedule's CronExpression enum doesn't include EVERY_2_SECONDS,
  // so we use the raw 6-field cron syntax: every 2 seconds, every minute, etc.
  // (Note: avoid putting the literal cron expression inside a JSDoc block —
  // TypeScript parses the asterisk-slash sequence as a comment terminator.)
  @Cron('*/2 * * * * *')
  async drain(): Promise<void> {
    if (this.flushing) return; // overlap guard — see flushing field comment
    this.flushing = true;
    try {
      const messages = await this.queue.read(
        ActivityWorkerService.BATCH_SIZE,
        ActivityWorkerService.VISIBILITY_TIMEOUT_SEC,
      );
      if (messages.length === 0) return;

      // Flatten every batch's events into one entity array. The agent often
      // submits 1-50 events per batch, so this typically expands ~200
      // messages into ~1,000-3,000 rows — perfect for one bulk insert.
      //
      // `deviceId` is carried on the batch payload (one deviceId per batch,
      // since each sync request is always from one machine) and copied onto
      // every row. Legacy payloads without deviceId stay null.
      const allEntities: ActivityEvent[] = [];
      for (const msg of messages) {
        const payload = msg.message;
        for (const e of payload.events ?? []) {
          allEntities.push(
            this.activityRepo.create({
              userId: payload.userId,
              organizationId: payload.organizationId,
              deviceId: payload.deviceId ?? null,
              appName: e.appName.slice(0, 255),
              windowTitle: e.windowTitle ? e.windowTitle.slice(0, 500) : null,
              startedAt: new Date(e.startedAt),
              durationSec: e.durationSec ?? Math.round((e.durationMs ?? 0) / 1000),
              keystrokeCount: e.keystrokeCount ?? 0,
            }),
          );
        }
      }

      // One bulk INSERT for the entire flattened batch.
      // chunk: 500 keeps any single SQL statement under the parameter limit
      // (Postgres has a hard cap of ~32K placeholders per statement).
      await this.activityRepo.save(allEntities, { chunk: 500 });

      // Only after the insert succeeds do we delete the messages from the
      // queue. A worker crash before this point means the messages reappear
      // when the visibility timeout expires.
      await this.queue.deleteMany(messages.map((m) => m.msg_id));

      this.logger.debug(
        `Drained ${messages.length} messages → inserted ${allEntities.length} activity events`,
      );
    } catch (err) {
      // Don't re-throw — let the cron continue. The unprocessed messages
      // will reappear in the queue after VISIBILITY_TIMEOUT_SEC and be
      // retried automatically.
      this.logger.error(`Activity drain failed: ${err}`);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * On API shutdown, do one final drain so a clean restart doesn't leave
   * messages waiting for the next instance to start. Bounded by 5s so we
   * don't block the shutdown forever.
   */
  async onModuleDestroy(): Promise<void> {
    if (!this.flushing) {
      await Promise.race([
        this.drain(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }
}
