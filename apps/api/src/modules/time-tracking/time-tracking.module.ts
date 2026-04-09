import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeTrackingController } from './time-tracking.controller';
import { TimeTrackingService } from './time-tracking.service';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';
import { Timesheet } from '../../database/entities/timesheet.entity';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance, TimeEntry, Timesheet]), AdminModule],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
})
export class TimeTrackingModule {}
