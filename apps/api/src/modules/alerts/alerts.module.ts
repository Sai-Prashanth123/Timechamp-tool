// apps/api/src/modules/alerts/alerts.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertRule } from '../../database/entities/alert-rule.entity';
import { AlertEvent } from '../../database/entities/alert-event.entity';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { MonitoringModule } from '../monitoring/monitoring.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AlertRule, AlertEvent]),
    MonitoringModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, MailerService],
  exports: [AlertsService],
})
export class AlertsModule {}
