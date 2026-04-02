import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { StreamingGateway } from './streaming.gateway';

const TEN_TB_BYTES = 10 * 1024 * 1024 * 1024 * 1024; // 10 TB

@Injectable()
export class EgressMonitorService {
  private readonly logger = new Logger(EgressMonitorService.name);

  // Gateway reference injected after module init to avoid circular dep
  gateway?: StreamingGateway;

  constructor(private redis: RedisService) {}

  @Cron('0 * * * *')
  async checkEgress() {
    const monthKey = `egress:monthly:${new Date().toISOString().slice(0, 7)}`;
    const val = await this.redis.get(monthKey);
    const bytes = val ? parseInt(val, 10) : 0;
    const pct = bytes / TEN_TB_BYTES;

    if (pct >= 0.95) {
      this.logger.error(`CRITICAL: Oracle egress at ${(pct * 100).toFixed(1)}% — stopping all streams`);
      this.gateway?.server?.emit('stream:control', JSON.stringify({ action: 'stop_streaming' }));
    } else if (pct >= 0.80) {
      this.logger.warn(`WARNING: Oracle egress at ${(pct * 100).toFixed(1)}% — reducing FPS`);
      this.gateway?.server?.emit('stream:control', JSON.stringify({ action: 'reduce_fps', maxFps: 1 }));
    }
  }
}
