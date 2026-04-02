import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenanceService } from './maintenance.service';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Screenshot]),
    AgentModule,
  ],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
