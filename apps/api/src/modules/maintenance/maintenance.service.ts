import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    @InjectRepository(Screenshot)
    private screenshotRepo: Repository<Screenshot>,
    private agentService: AgentService,
  ) {}

  // Run at 2:00 AM every day
  @Cron('0 2 * * *')
  async cleanupOldScreenshots(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const old = await this.screenshotRepo.find({
      where: { capturedAt: LessThan(cutoff) },
      select: ['id', 's3Key'],
      take: 500, // process in batches to avoid memory issues
    });

    if (old.length === 0) {
      this.logger.log('Screenshot cleanup: nothing to delete');
      return;
    }

    let deleted = 0;
    for (const screenshot of old) {
      try {
        await this.agentService.deleteS3Object(screenshot.s3Key);
        await this.screenshotRepo.delete(screenshot.id);
        deleted++;
      } catch (err) {
        this.logger.error(`Failed to delete screenshot ${screenshot.id}: ${err}`);
      }
    }

    this.logger.log(`Screenshot cleanup: deleted ${deleted}/${old.length} screenshots older than 90 days`);
  }
}
