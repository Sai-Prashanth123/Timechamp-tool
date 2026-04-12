import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentController } from './agent.controller';
import { AgentRegistrationController } from './agent-registration.controller';
import { AgentManagementController } from './agent-management.controller';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { HeartbeatBufferService } from './heartbeat-buffer.service';
import { ActivityQueueService } from './activity-queue.service';
import { ActivityWorkerService } from './activity-worker.service';
import { MetricsQueueService } from './metrics-queue.service';
import { MetricsWorkerService } from './metrics-worker.service';
import { KeystrokesQueueService } from './keystrokes-queue.service';
import { KeystrokesWorkerService } from './keystrokes-worker.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { ActivityEvent } from '../../database/entities/activity-event.entity';
import { Screenshot } from '../../database/entities/screenshot.entity';
import { User } from '../../database/entities/user.entity';
import { GpsLocation } from '../../database/entities/gps-location.entity';
import { Organization } from '../../database/entities/organization.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { AgentMetric } from '../../database/entities/agent-metric.entity';
import { KeystrokeEvent } from '../../database/entities/keystroke-event.entity';
import { AgentTelemetry } from '../../database/entities/agent-telemetry.entity';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActivityEvent, Screenshot, User, GpsLocation, Organization, AgentDevice, AgentMetric,
      KeystrokeEvent, AgentTelemetry,
    ]),
    forwardRef(() => MonitoringModule),
    UsersModule,
  ],
  controllers: [AgentController, AgentRegistrationController, AgentManagementController],
  providers: [
    AgentService,
    AgentAuthGuard,
    HeartbeatBufferService,
    ActivityQueueService,
    ActivityWorkerService,
    MetricsQueueService,
    MetricsWorkerService,
    KeystrokesQueueService,
    KeystrokesWorkerService,
    TokenService,
  ],
  exports: [AgentService],
})
export class AgentModule {}
