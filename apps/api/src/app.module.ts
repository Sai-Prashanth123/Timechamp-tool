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
import { AlertRule } from './database/entities/alert-rule.entity';
import { AlertEvent } from './database/entities/alert-event.entity';
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
import { TaskComment } from './database/entities/task-comment.entity';
import { Milestone } from './database/entities/milestone.entity';
import { GpsLocation } from './database/entities/gps-location.entity';
import { Geofence } from './database/entities/geofence.entity';
import { ProjectsModule } from './modules/projects/projects.module';
import { StreamSession } from './database/entities/stream-session.entity';
import { StreamingModule } from './modules/streaming/streaming.module';
import { AgentDevice } from './database/entities/agent-device.entity';
import { AgentMetric } from './database/entities/agent-metric.entity';
import { KeystrokeEvent } from './database/entities/keystroke-event.entity';
import { AgentTelemetry } from './database/entities/agent-telemetry.entity';
import { AuditLog } from './database/entities/audit-log.entity';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().optional(),
        DB_HOST: Joi.string().optional(),
        DB_PORT: Joi.number().default(5432),
        DB_USER: Joi.string().optional(),
        DB_PASS: Joi.string().optional(),
        DB_NAME: Joi.string().default('postgres'),
        REDIS_URL: Joi.string().optional(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        STRIPE_SECRET_KEY: Joi.string().optional(),
        STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
        STRIPE_PRICE_STARTER: Joi.string().optional(),
        STRIPE_PRICE_PRO: Joi.string().optional(),
        STRIPE_PRICE_ENTERPRISE: Joi.string().optional(),
        APP_URL: Joi.string().uri().required(),
        SMTP_HOST: Joi.string().optional(),
        SMTP_PORT: Joi.number().default(587),
        SMTP_SECURE: Joi.boolean().default(false),
        SMTP_USER: Joi.string().optional(),
        SMTP_PASS: Joi.string().optional(),
        SMTP_FROM: Joi.string().optional(),
        S3_BUCKET: Joi.string().optional(),
        AWS_REGION: Joi.string().default('us-east-1'),
        S3_ENDPOINT: Joi.string().uri().optional(),
        B2_BUCKET: Joi.string().optional(),
        B2_ENDPOINT: Joi.string().when('B2_BUCKET', { is: Joi.exist(), then: Joi.required(), otherwise: Joi.optional() }),
        B2_KEY_ID: Joi.string().when('B2_BUCKET', { is: Joi.exist(), then: Joi.required(), otherwise: Joi.optional() }),
        B2_APP_KEY: Joi.string().when('B2_BUCKET', { is: Joi.exist(), then: Joi.required(), otherwise: Joi.optional() }),
        B2_CDN_URL: Joi.string().optional(),
        SUPABASE_URL: Joi.string().uri().optional(),
        SUPABASE_SERVICE_KEY: Joi.string().optional(),
        STREAMING_ENABLED: Joi.boolean().default(false),
        WS_CORS_ORIGIN: Joi.string().optional(),
        DAILY_BW_CAP_MB: Joi.number().default(500),
        SESSION_MAX_HOURS: Joi.number().default(8),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbHost = config.get<string>('DB_HOST');
        const useIndividual = !!dbHost;
        const baseConfig = useIndividual
          ? {
              host: dbHost,
              port: config.get<number>('DB_PORT') ?? 5432,
              username: config.get<string>('DB_USER'),
              password: config.get<string>('DB_PASS'),
              database: config.get<string>('DB_NAME') ?? 'postgres',
            }
          : { url: config.get<string>('DATABASE_URL') };
        const isSupabase =
          (dbHost ?? config.get<string>('DATABASE_URL') ?? '').includes('supabase');
        return {
          type: 'postgres' as const,
          ...baseConfig,
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
          TaskComment,
          Milestone,
          GpsLocation,
          Geofence,
          WebhookEndpoint,
          WebhookDelivery,
          SlackIntegration,
          AlertRule,
          AlertEvent,
          StreamSession,
          AgentDevice,
          AgentMetric,
          KeystrokeEvent,
          AgentTelemetry,
          AuditLog,
        ],
          migrations: ['dist/database/migrations/*.js'],
          migrationsRun: false,
          synchronize: false,
          logging: config.get('NODE_ENV') !== 'production',
          ssl: isSupabase ? { rejectUnauthorized: false } : false,
          // Production-scale pool config — Round 5 / R5.1.
          // At 100K concurrent agents, the default pool of 10 deadlocks in
          // seconds. With 50 warm connections and aggressive query timeouts,
          // each connection can sustain ~500 QPS at ~100ms avg query time,
          // giving us 25K QPS of headroom. `statement_timeout` aborts any
          // single hung query instead of letting it starve the whole pool.
          extra: {
            max: 50,
            min: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 10_000,
            query_timeout: 10_000,
          },
        };
      },
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
    StreamingModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
