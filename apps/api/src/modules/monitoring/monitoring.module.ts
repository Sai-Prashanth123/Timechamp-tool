import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEvent, Screenshot, Attendance]),
    AgentModule,
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
