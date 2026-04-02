import * as Joi from 'joi';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { AgentModule } from './modules/agent/agent.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { GpsModule } from './modules/gps/gps.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AlertRule } from './modules/alerts/alert-rule.entity';
import { AlertEvent } from './modules/alerts/alert-event.entity';
import { WebhookEndpoint } from './database/entities/webhook-endpoint.entity';
import { WebhookDelivery } from './database/entities/webhook-delivery.entity';
import { SlackIntegration } from './database/entities/slack-integration.entity';
import { RedisModule } from './infrastructure/redis/redis.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { Organization } from './database/entities/organization.entity';
import { User } from './database/entities/user.entity';
import { Subscription } from './database/entities/subscription.entity';
import { RefreshToken } from './database/entities/refresh-token.entity';
import { Attendance } from './database/entities/attendance.entity';
import { TimeEntry } from './database/entities/time-entry.entity';
import { Timesheet } from './database/entities/timesheet.entity';
import { ActivityEvent } from './database/entities/activity-event.entity';
import { Screenshot } from './database/entities/screenshot.entity';
import { Project } from './database/entities/project.entity';
import { Task } from './database/entities/task.entity';
import { Milestone } from './database/entities/milestone.entity';
import { GpsLocation } from './database/entities/gps-location.entity';
import { Geofence } from './database/entities/geofence.entity';
import { ProjectsModule } from './modules/projects/projects.module';
import { StreamSession } from './database/entities/stream-session.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        STRIPE_SECRET_KEY: Joi.string().optional(),
        APP_URL: Joi.string().uri().required(),
        S3_BUCKET: Joi.string().optional(),
        AWS_REGION: Joi.string().default('us-east-1'),
        S3_ENDPOINT: Joi.string().uri().optional(),
        B2_BUCKET: Joi.string().optional(),
        B2_ENDPOINT: Joi.string().optional(),
        B2_KEY_ID: Joi.string().optional(),
        B2_APP_KEY: Joi.string().optional(),
        B2_CDN_URL: Joi.string().optional(),
        STREAMING_ENABLED: Joi.boolean().default(false),
        WS_CORS_ORIGIN: Joi.string().optional(),
        DAILY_BW_CAP_MB: Joi.number().default(500),
        SESSION_MAX_HOURS: Joi.number().default(8),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [
          Organization,
          User,
          Subscription,
          RefreshToken,
          Attendance,
          TimeEntry,
          Timesheet,
          ActivityEvent,
          Screenshot,
          Project,
          Task,
          Milestone,
          GpsLocation,
          Geofence,
          WebhookEndpoint,
          WebhookDelivery,
          SlackIntegration,
          AlertRule,
          AlertEvent,
          StreamSession,
        ],
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') !== 'production',
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : false,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    ScheduleModule.forRoot(),
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    TimeTrackingModule,
    AgentModule,
    MonitoringModule,
    AnalyticsModule,
    ProjectsModule,
    GpsModule,
    IntegrationsModule,
    AlertsModule,
    MaintenanceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
