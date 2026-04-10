import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';
import { MonitoringGateway } from './monitoring.gateway';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { Attendance } from '../../database/entities/attendance.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ActivityEvent, Screenshot, Attendance, AgentDevice]),
    forwardRef(() => AgentModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MonitoringController],
  providers: [MonitoringService, MonitoringGateway],
  exports: [MonitoringGateway],
})
export class MonitoringModule {}
