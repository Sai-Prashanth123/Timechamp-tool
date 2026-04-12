import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenanceService } from './maintenance.service';
import { HealthController } from './health.controller';
import { ProbeController } from './probe.controller';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Screenshot]),
    AgentModule,
  ],
  controllers: [HealthController, ProbeController],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
