import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, Attendance, TimeEntry])],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
