import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StreamSession } from '../../database/entities/stream-session.entity';
import { Organization } from '../../database/entities/organization.entity';
import { User } from '../../database/entities/user.entity';
import { StreamingController } from './streaming.controller';
import { StreamingGateway } from './streaming.gateway';
import { StreamingService } from './streaming.service';
import { EgressMonitorService } from './egress-monitor.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StreamSession, Organization, User]),
    AuthModule,
  ],
  controllers: [StreamingController],
  providers: [StreamingGateway, StreamingService, EgressMonitorService],
  exports: [StreamingService],
})
export class StreamingModule implements OnModuleInit {
  constructor(
    private readonly gateway: StreamingGateway,
    private readonly egressMonitor: EgressMonitorService,
  ) {}

  onModuleInit() {
    // Wire gateway reference to egress monitor (avoids circular dep)
    this.egressMonitor.gateway = this.gateway;
  }
}
