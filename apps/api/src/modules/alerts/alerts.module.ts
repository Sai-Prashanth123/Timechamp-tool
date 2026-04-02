import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertRule } from './alert-rule.entity';
import { AlertEvent } from './alert-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AlertRule, AlertEvent])],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
