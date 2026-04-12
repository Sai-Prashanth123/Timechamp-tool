import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KeystrokeEvent } from '../../database/entities/keystroke-event.entity';
import { KeystrokesQueueService } from './keystrokes-queue.service';

/**
 * KeystrokesWorkerService — drains the agent_keystrokes pgmq queue and bulk-inserts.
 *
 * Runs every 5 seconds. Keystroke events are even lower volume than metrics
 * — typically 1 row per minute per active agent. The worker is here purely
 * for consistency with the activity / metrics flow and to keep saveKeystrokes
 * off the synchronous Postgres write path.
 */
@Injectable()
export class KeystrokesWorkerService implements OnModuleDestroy {
  private readonly logger = new Logger(KeystrokesWorkerService.name);
  private static readonly BATCH_SIZE = 200;
  private static readonly VISIBILITY_TIMEOUT_SEC = 30;
  private flushing = false;

  constructor(
    private readonly queue: KeystrokesQueueService,
    @InjectRepository(KeystrokeEvent)
    private readonly keystrokeRepo: Repository<KeystrokeEvent>,
  ) {}

  @Cron('*/5 * * * * *')
  async drain(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const messages = await this.queue.read(
        KeystrokesWorkerService.BATCH_SIZE,
        KeystrokesWorkerService.VISIBILITY_TIMEOUT_SEC,
      );
      if (messages.length === 0) return;

      const allEntities: KeystrokeEvent[] = [];
      for (const msg of messages) {
        const payload = msg.message;
        for (const e of payload.events ?? []) {
          allEntities.push(
            this.keystrokeRepo.create({
              userId: payload.userId,
              organizationId: payload.organizationId,
              keysPerMin: e.keysPerMin,
              mousePerMin: e.mousePerMin,
              recordedAt: new Date(e.recordedAt),
            }),
          );
        }
      }

      await this.keystrokeRepo.save(allEntities, { chunk: 500 });
      await this.queue.deleteMany(messages.map((m) => m.msg_id));

      this.logger.debug(
        `Drained ${messages.length} keystroke messages → inserted ${allEntities.length} rows`,
      );
    } catch (err) {
      this.logger.error(`Keystrokes drain failed: ${err}`);
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
