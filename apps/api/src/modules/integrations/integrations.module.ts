import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookEndpoint } from '../../database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '../../database/entities/webhook-delivery.entity';
import { SlackIntegration } from '../../database/entities/slack-integration.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEndpoint, WebhookDelivery, SlackIntegration]),
  ],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],   // exported so TimeTracking / Projects can call deliverWebhook
})
export class IntegrationsModule {}
