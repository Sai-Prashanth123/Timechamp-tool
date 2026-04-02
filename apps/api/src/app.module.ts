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
        STRIPE_SECRET_KEY: Joi.string().required(),
        APP_URL: Joi.string().uri().required(),
        S3_BUCKET: Joi.string().optional(),
        AWS_REGION: Joi.string().default('us-east-1'),
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
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    TimeTrackingModule,
    AgentModule,
    MonitoringModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
