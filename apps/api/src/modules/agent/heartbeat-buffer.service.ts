import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentDevice } from '../../database/entities/agent-device.entity';

/**
 * HeartbeatBufferService (Round 5 / R5.3, device-centric since v2)
 *
 * Write-behind cache for agent heartbeats. Agents POST /agent/sync/heartbeat
 * every 60 seconds — at 100K agents that's 1,667 UPDATEs per second on the
 * `agent_devices` table, which causes row-level lock contention and burns
 * connection-pool slots.
 *
 * Instead, the service keeps only the LATEST heartbeat for each DEVICE in
 * an in-memory Map (older entries are just overwritten — we don't need
 * intermediate history). Every 5 seconds, a @Cron drains the map with a
 * single bulk UPDATE using Postgres `unnest()` for parameterized arrays.
 *
 * Device-centric note: originally this keyed on `userId` and updated every
 * active device owned by that user. That meant a user with 2 machines had
 * one device silently refreshing the other's `last_seen_at`, which made
 * offline detection unreliable and broke "Live — N online" counting. Now
 * we key on `deviceId` so each machine has its own independent timer.
 *
 * Result: 1,600 individual UPDATEs/sec → one bulk UPDATE per 5 seconds
 * affecting ~1,600 rows at a time. Same data, ~1,000× fewer transactions.
 *
 * Semantics preserved:
 *  - `last_seen_at` is eventually consistent within 5 seconds. That's fine —
 *    the monitoring sweep cron already uses a 90-second offline threshold.
 *  - Live-view `employee:status` WebSocket events still fire immediately
 *    from AgentService.recordHeartbeat — only the DB write is deferred.
 *  - On API shutdown, the OnModuleDestroy hook flushes one last batch so
 *    the final heartbeats don't disappear on a clean restart.
 */
@Injectable()
export class HeartbeatBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatBufferService.name);
  // Keyed by deviceId. See class docstring for why it's not userId.
  private readonly pending = new Map<string, Date>();

  constructor(
    @InjectRepository(AgentDevice)
    private readonly deviceRepo: Repository<AgentDevice>,
  ) {}

  /**
   * Record the latest heartbeat for a device. Overwrites any previous entry
   * for the same deviceId — only the most recent lastSeenAt matters.
   *
   * `deviceId` is optional so legacy callers that don't yet have device
   * context (Redis cache entries from before the v2 guard deploy, tests
   * that construct the service without a full request) still work — those
   * are silently dropped rather than misrouted to the wrong device. In
   * production steady state every heartbeat has a deviceId within 5 min
   * of the deploy (v2 cache TTL).
   */
  record(deviceId: string | undefined, lastSeenAt: Date, _userId?: string): void {
    if (!deviceId) {
      this.logger.warn('Heartbeat received without deviceId — dropped (pre-v2 cache entry?)');
      return;
    }
    this.pending.set(deviceId, lastSeenAt);
  }

  /**
   * Drain the buffer into a single bulk UPDATE using unnest().
   *
   * The unnest() pattern sends two parallel arrays (device_ids, timestamps)
   * as parameters and joins them row-wise into a virtual table that the
   * UPDATE can reference. This is orders of magnitude faster than N
   * individual UPDATEs even in a single transaction.
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    // Atomic drain: swap the pending map so new records during the flush
    // go into a fresh map and aren't lost if the UPDATE takes a while.
    const snapshot = Array.from(this.pending.entries());
    this.pending.clear();

    const deviceIds = snapshot.map(([id]) => id);
    const timestamps = snapshot.map(([, ts]) => ts);

    try {
      await this.deviceRepo.query(
        `UPDATE agent_devices AS d
           SET last_seen_at = v.ts
           FROM (
             SELECT unnest($1::uuid[]) AS did,
                    unnest($2::timestamptz[]) AS ts
           ) AS v
          WHERE d.id = v.did
            AND d.is_active = true`,
        [deviceIds, timestamps],
      );
    } catch (err) {
      // If the bulk UPDATE fails, push entries back into the pending map
      // so we retry on the next flush. Use setIfNewer semantics — if newer
      // heartbeats landed during the failed flush, don't clobber them.
      this.logger.error(`Bulk heartbeat flush failed (${snapshot.length} rows): ${err}`);
      for (const [id, ts] of snapshot) {
        const existing = this.pending.get(id);
        if (!existing || existing < ts) this.pending.set(id, ts);
      }
    }
  }

  /**
   * On API shutdown, best-effort flush the final batch. The @Cron won't
   * fire again so this is our only chance to not lose the last few
   * seconds of heartbeats.
   */
  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
