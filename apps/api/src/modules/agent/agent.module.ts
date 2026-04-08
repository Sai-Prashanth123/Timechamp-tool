import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { User } from '../../database/entities/user.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, Screenshot, User, GpsLocation, Organization, AgentDevice])],
  controllers: [AgentController],
  providers: [AgentService, AgentAuthGuard],
  exports: [AgentService],
})
export class AgentModule {}
