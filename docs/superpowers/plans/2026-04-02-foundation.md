# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundational SaaS layer — monorepo scaffold, PostgreSQL with RLS multi-tenancy, NestJS API with auth/orgs/users/billing modules, and a Next.js dashboard shell with login, registration, and settings pages.

**Architecture:** pnpm monorepo with `apps/api` (NestJS) and `apps/web` (Next.js). All API requests flow through JWT auth → tenant middleware → RLS-protected PostgreSQL. Stripe handles subscriptions. Redis stores token blacklist and cache.

**Tech Stack:** Node.js 20, pnpm workspaces, NestJS 10, TypeORM, PostgreSQL 15, Redis 7, Next.js 14, shadcn/ui, TailwindCSS, TanStack Query, NextAuth.js, Stripe, Zod, Docker Compose (local dev)

---

## File Map

### Monorepo Root
- Create: `package.json` — pnpm workspace root
- Create: `pnpm-workspace.yaml` — workspace config
- Create: `docker-compose.yml` — PostgreSQL + Redis for local dev
- Create: `.env.example` — all required env vars documented
- Create: `.gitignore`

### apps/api (NestJS)
- Create: `apps/api/src/main.ts` — bootstrap, graceful shutdown, CORS
- Create: `apps/api/src/app.module.ts` — root module, TypeORM config, Redis
- Create: `apps/api/src/database/migrations/001_initial_schema.ts` — full initial schema with RLS
- Create: `apps/api/src/database/entities/organization.entity.ts`
- Create: `apps/api/src/database/entities/user.entity.ts`
- Create: `apps/api/src/database/entities/subscription.entity.ts`
- Create: `apps/api/src/database/entities/refresh-token.entity.ts`
- Create: `apps/api/src/common/filters/global-exception.filter.ts`
- Create: `apps/api/src/common/interceptors/transform.interceptor.ts`
- Create: `apps/api/src/common/interceptors/logging.interceptor.ts`
- Create: `apps/api/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/common/guards/roles.guard.ts`
- Create: `apps/api/src/common/guards/tenant.guard.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Create: `apps/api/src/common/decorators/roles.decorator.ts`
- Create: `apps/api/src/common/middleware/tenant.middleware.ts`
- Create: `apps/api/src/infrastructure/redis/redis.module.ts`
- Create: `apps/api/src/infrastructure/redis/redis.service.ts`
- Create: `apps/api/src/infrastructure/mailer/mailer.service.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `apps/api/src/modules/auth/strategies/jwt-refresh.strategy.ts`
- Create: `apps/api/src/modules/auth/dto/register.dto.ts`
- Create: `apps/api/src/modules/auth/dto/login.dto.ts`
- Create: `apps/api/src/modules/organizations/organizations.module.ts`
- Create: `apps/api/src/modules/organizations/organizations.controller.ts`
- Create: `apps/api/src/modules/organizations/organizations.service.ts`
- Create: `apps/api/src/modules/organizations/dto/create-organization.dto.ts`
- Create: `apps/api/src/modules/organizations/dto/update-organization.dto.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/dto/invite-user.dto.ts`
- Create: `apps/api/src/modules/users/dto/update-user.dto.ts`
- Create: `apps/api/src/modules/billing/billing.module.ts`
- Create: `apps/api/src/modules/billing/billing.controller.ts`
- Create: `apps/api/src/modules/billing/billing.service.ts`
- Create: `apps/api/src/modules/billing/billing-webhook.controller.ts`
- Create: `apps/api/test/auth.e2e-spec.ts`
- Create: `apps/api/test/organizations.e2e-spec.ts`
- Create: `apps/api/test/users.e2e-spec.ts`

### apps/web (Next.js)
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx` — redirect to /overview or /login
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(dashboard)/layout.tsx` — sidebar + header shell
- Create: `apps/web/app/(dashboard)/overview/page.tsx` — placeholder
- Create: `apps/web/app/(dashboard)/settings/organization/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/billing/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/users/page.tsx`
- Create: `apps/web/components/dashboard/sidebar.tsx`
- Create: `apps/web/components/dashboard/header.tsx`
- Create: `apps/web/components/auth/login-form.tsx`
- Create: `apps/web/components/auth/register-form.tsx`
- Create: `apps/web/lib/api.ts` — axios instance with JWT + refresh interceptor
- Create: `apps/web/lib/auth.ts` — NextAuth config
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/hooks/use-auth.ts`
- Create: `apps/web/hooks/use-organization.ts`

---

## Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `.env.example`

- [ ] **Step 1: Initialize monorepo**

```bash
mkdir -p apps/api apps/web packages/shared
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "timechamp",
  "private": true,
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "dev": "concurrently \"pnpm dev:api\" \"pnpm dev:web\"",
    "build:api": "pnpm --filter api build",
    "build:web": "pnpm --filter web build",
    "test:api": "pnpm --filter api test",
    "test:api:e2e": "pnpm --filter api test:e2e"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

- [ ] **Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.next/
.env
*.env.local
.DS_Store
coverage/
```

- [ ] **Step 5: Create docker-compose.yml**

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: timechamp
      POSTGRES_USER: timechamp
      POSTGRES_PASSWORD: timechamp_dev
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U timechamp"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 6: Create .env.example**

```env
# Database
DATABASE_URL=postgresql://timechamp:timechamp_dev@localhost:5432/timechamp

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=change_me_in_production_min_32_chars
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change_me_refresh_secret_min_32_chars
JWT_REFRESH_EXPIRES_IN=7d

# Stripe
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID_STARTER=price_xxx
STRIPE_PRICE_ID_PRO=price_xxx

# App
APP_URL=http://localhost:3000
API_URL=http://localhost:3001

# Email (AWS SES or SMTP for local)
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM=noreply@timechamp.io
```

- [ ] **Step 7: Start Docker services and verify**

```bash
docker compose up -d
docker compose ps
```

Expected: Both `postgres` and `redis` show `healthy`.

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "chore: initialize monorepo with docker compose"
```

---

## Task 2: NestJS API Bootstrap

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`

- [ ] **Step 1: Scaffold NestJS app**

```bash
cd apps/api
pnpm init
```

- [ ] **Step 2: Create apps/api/package.json**

```json
{
  "name": "api",
  "version": "0.0.1",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "test": "jest",
    "test:e2e": "jest --config ./test/jest-e2e.json"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/swagger": "^7.0.0",
    "@nestjs/throttler": "^5.0.0",
    "typeorm": "^0.3.17",
    "pg": "^8.11.0",
    "ioredis": "^5.3.2",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "bcrypt": "^5.1.1",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.1",
    "stripe": "^14.0.0",
    "nodemailer": "^6.9.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/jest": "^29.0.0",
    "@types/node": "^20.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/passport-jwt": "^4.0.0",
    "jest": "^29.0.0",
    "supertest": "^6.3.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 3: Create apps/api/tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "strictFunctionTypes": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 4: Create apps/api/src/main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.APP_URL, credentials: true });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const config = new DocumentBuilder()
    .setTitle('TimeChamp API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    await app.close();
    process.exit(0);
  });
}

bootstrap();
```

- [ ] **Step 5: Create apps/api/src/app.module.ts**

```typescript
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { Organization } from './database/entities/organization.entity';
import { User } from './database/entities/user.entity';
import { Subscription } from './database/entities/subscription.entity';
import { RefreshToken } from './database/entities/refresh-token.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [Organization, User, Subscription, RefreshToken],
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: true,
        logging: config.get('NODE_ENV') !== 'production',
        ssl: config.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 6: Install dependencies**

```bash
cd apps/api
pnpm install
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/
git commit -m "feat(api): bootstrap NestJS application"
```

---

## Task 3: Database Entities and Initial Migration

**Files:**
- Create: `apps/api/src/database/entities/organization.entity.ts`
- Create: `apps/api/src/database/entities/user.entity.ts`
- Create: `apps/api/src/database/entities/subscription.entity.ts`
- Create: `apps/api/src/database/entities/refresh-token.entity.ts`
- Create: `apps/api/src/database/migrations/001_initial_schema.ts`

- [ ] **Step 1: Create organization.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

export enum OrgPlan {
  STARTER = 'starter',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
}

@Entity('organizations')
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 255, unique: true })
  slug: string;

  @Column({ type: 'enum', enum: OrgPlan, default: OrgPlan.STARTER })
  plan: OrgPlan;

  @Column({ default: 5 })
  seats: number;

  @Column({ nullable: true })
  logoUrl: string;

  @Column({ nullable: true })
  website: string;

  @Column({ nullable: true })
  timezone: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Create user.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, BeforeInsert } from 'typeorm';
import { Organization } from './organization.entity';

export enum UserRole {
  ADMIN = 'admin',
  MANAGER = 'manager',
  EMPLOYEE = 'employee',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ length: 255 })
  email: string;

  @Column({ select: false })
  passwordHash: string;

  @Column({ length: 255 })
  firstName: string;

  @Column({ length: 255 })
  lastName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.EMPLOYEE })
  role: UserRole;

  @Column({ nullable: true })
  avatarUrl: string;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  invitedBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 3: Create subscription.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  TRIALING = 'trialing',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ nullable: true })
  stripeCustomerId: string;

  @Column({ nullable: true })
  stripeSubscriptionId: string;

  @Column({ nullable: true })
  stripePriceId: string;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.TRIALING })
  status: SubscriptionStatus;

  @Column({ default: 5 })
  seats: number;

  @Column({ nullable: true })
  currentPeriodStart: Date;

  @Column({ nullable: true })
  currentPeriodEnd: Date;

  @Column({ nullable: true })
  canceledAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 4: Create refresh-token.entity.ts**

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  organizationId: string;

  @Column({ unique: true })
  token: string;

  @Column()
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @Column({ nullable: true })
  revokedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 5: Create initial migration 001_initial_schema.ts**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable uuid-ossp extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Organizations
    await queryRunner.query(`
      CREATE TYPE org_plan AS ENUM ('starter', 'pro', 'enterprise');
      CREATE TABLE organizations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        plan org_plan NOT NULL DEFAULT 'starter',
        seats INTEGER NOT NULL DEFAULT 5,
        logo_url VARCHAR(500),
        website VARCHAR(500),
        timezone VARCHAR(100) DEFAULT 'UTC',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Users
    await queryRunner.query(`
      CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee');
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        role user_role NOT NULL DEFAULT 'employee',
        avatar_url VARCHAR(500),
        email_verified BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        invited_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id, email)
      );
      CREATE INDEX idx_users_org_id ON users(organization_id);
      CREATE INDEX idx_users_email ON users(email);
    `);

    // Subscriptions
    await queryRunner.query(`
      CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
      CREATE TABLE subscriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        stripe_price_id VARCHAR(255),
        status subscription_status NOT NULL DEFAULT 'trialing',
        seats INTEGER NOT NULL DEFAULT 5,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        canceled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Refresh tokens
    await queryRunner.query(`
      CREATE TABLE refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        token VARCHAR(500) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked BOOLEAN NOT NULL DEFAULT false,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);

    // Row Level Security — enforce per-organization isolation
    await queryRunner.query(`
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

      -- RLS policies: rows visible only when organization_id matches session variable
      CREATE POLICY tenant_isolation ON users
        USING (organization_id::text = current_setting('app.current_org', true));

      CREATE POLICY tenant_isolation ON subscriptions
        USING (organization_id::text = current_setting('app.current_org', true));

      CREATE POLICY tenant_isolation ON refresh_tokens
        USING (organization_id::text = current_setting('app.current_org', true));

      -- Allow superuser / migration role to bypass RLS
      ALTER TABLE users FORCE ROW LEVEL SECURITY;
      ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
      ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscriptions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS users CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS organizations CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS subscription_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);
    await queryRunner.query(`DROP TYPE IF EXISTS org_plan`);
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/
git commit -m "feat(api): add database entities and initial migration with RLS"
```

---

## Task 4: Common Infrastructure (Guards, Filters, Middleware)

**Files:**
- Create: `apps/api/src/common/filters/global-exception.filter.ts`
- Create: `apps/api/src/common/interceptors/transform.interceptor.ts`
- Create: `apps/api/src/common/interceptors/logging.interceptor.ts`
- Create: `apps/api/src/common/guards/jwt-auth.guard.ts`
- Create: `apps/api/src/common/guards/roles.guard.ts`
- Create: `apps/api/src/common/guards/tenant.guard.ts`
- Create: `apps/api/src/common/decorators/current-user.decorator.ts`
- Create: `apps/api/src/common/decorators/roles.decorator.ts`
- Create: `apps/api/src/common/middleware/tenant.middleware.ts`
- Create: `apps/api/src/infrastructure/redis/redis.module.ts`
- Create: `apps/api/src/infrastructure/redis/redis.service.ts`

- [ ] **Step 1: Create global-exception.filter.ts**

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? message;
    }

    // Never expose stack traces — log internally only
    this.logger.error(`${request.method} ${request.url} → ${status}`, exception instanceof Error ? exception.stack : String(exception));

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

- [ ] **Step 2: Create transform.interceptor.ts**

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

- [ ] **Step 3: Create logging.interceptor.ts**

```typescript
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} — ${ms}ms`);
      }),
    );
  }
}
```

- [ ] **Step 4: Create current-user.decorator.ts**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../database/entities/user.entity';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 5: Create roles.decorator.ts**

```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../database/entities/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 6: Create jwt-auth.guard.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 7: Create roles.guard.ts**

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../database/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Access denied');

    const hasRole = requiredRoles.includes(user.role);
    if (!hasRole) throw new ForbiddenException(`Requires one of: ${requiredRoles.join(', ')}`);

    return true;
  }
}
```

- [ ] **Step 8: Create tenant.guard.ts**

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../database/entities/organization.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    @InjectRepository(Subscription) private subsRepo: Repository<Subscription>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.organizationId) return true; // Public routes handled by JwtAuthGuard

    const org = await this.orgsRepo.findOne({ where: { id: user.organizationId, isActive: true } });
    if (!org) throw new ForbiddenException('Organization not found or inactive');

    const sub = await this.subsRepo.findOne({ where: { organizationId: user.organizationId } });
    if (sub && sub.status === SubscriptionStatus.CANCELED) {
      throw new ForbiddenException('Subscription canceled. Please reactivate to continue.');
    }

    return true;
  }
}
```

- [ ] **Step 9: Create tenant.middleware.ts**

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // organizationId is set on req.user by JwtStrategy after token validation
    const orgId = (req as any).user?.organizationId;

    if (orgId) {
      // Set PostgreSQL session variable — RLS policies read this
      await this.dataSource.query(`SET LOCAL app.current_org = '${orgId}'`);
    }

    next();
  }
}
```

- [ ] **Step 10: Create redis.module.ts**

```typescript
import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 11: Create redis.service.ts**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.client = new Redis(this.config.get('REDIS_URL')!, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err) => this.logger.error('Redis error', err));
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }
}
```

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/common/ apps/api/src/infrastructure/
git commit -m "feat(api): add guards, filters, middleware, and Redis service"
```

---

## Task 5: Auth Module

**Files:**
- Create: `apps/api/src/modules/auth/dto/register.dto.ts`
- Create: `apps/api/src/modules/auth/dto/login.dto.ts`
- Create: `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
- Create: `apps/api/src/modules/auth/strategies/jwt-refresh.strategy.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.module.ts`

- [ ] **Step 1: Write failing e2e test for auth**

Create `apps/api/test/auth.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new organization and admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          organizationName: 'Acme Corp',
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@acme.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user.email).toBe('john@acme.com');
      expect(res.body.data.user.role).toBe('admin');
    });

    it('should reject duplicate email within same org', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        organizationName: 'Acme Corp 2',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@acme2.com',
        password: 'Password123!',
      });

      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        organizationName: 'Acme Corp 2',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@acme2.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return tokens on valid credentials', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email: 'john@acme.com',
        password: 'Password123!',
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('accessToken');
    });

    it('should reject invalid password', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email: 'john@acme.com',
        password: 'WrongPassword!',
      });

      expect(res.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test:e2e -- --testPathPattern=auth
```

Expected: FAIL — modules not yet implemented.

- [ ] **Step 3: Create register.dto.ts**

```typescript
import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  organizationName: string;

  @ApiProperty({ example: 'John' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'john@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;
}
```

- [ ] **Step 4: Create login.dto.ts**

```typescript
import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Password123!' })
  @IsString()
  password: string;
}
```

- [ ] **Step 5: Create jwt.strategy.ts**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../database/entities/user.entity';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export interface JwtPayload {
  sub: string;       // user id
  orgId: string;     // organization id
  role: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private redis: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET')!,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload): Promise<User> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);

    // Check blacklist (logout invalidates tokens)
    const isBlacklisted = await this.redis.exists(`blacklist:${token}`);
    if (isBlacklisted) throw new UnauthorizedException('Token revoked');

    const user = await this.usersRepo.findOne({
      where: { id: payload.sub, organizationId: payload.orgId, isActive: true },
    });

    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }
}
```

- [ ] **Step 6: Create auth.service.ts**

```typescript
import { Injectable, ConflictException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    @InjectRepository(RefreshToken) private refreshTokensRepo: Repository<RefreshToken>,
    @InjectRepository(Subscription) private subsRepo: Repository<Subscription>,
    private jwtService: JwtService,
    private config: ConfigService,
    private redis: RedisService,
    private dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const slug = dto.organizationName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + randomBytes(3).toString('hex');

    return this.dataSource.transaction(async (manager) => {
      // Check if org slug already taken
      const existing = await manager.findOne(Organization, { where: { slug } });
      if (existing) throw new ConflictException('Organization slug already exists');

      // Create organization
      const org = manager.create(Organization, { name: dto.organizationName, slug });
      await manager.save(org);

      // Create subscription (trial)
      const sub = manager.create(Subscription, { organizationId: org.id });
      await manager.save(sub);

      // Hash password
      const passwordHash = await bcrypt.hash(dto.password, 12);

      // Create admin user
      const user = manager.create(User, {
        organizationId: org.id,
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.ADMIN,
        emailVerified: false,
      });
      await manager.save(user);

      return this.generateTokens(user);
    });
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email: dto.email })
      .andWhere('user.isActive = true')
      .getOne();

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user);
  }

  async logout(userId: string, accessToken: string): Promise<void> {
    // Blacklist access token until its natural expiry (15 min TTL)
    await this.redis.set(`blacklist:${accessToken}`, '1', 15 * 60);

    // Revoke all refresh tokens for this user
    await this.refreshTokensRepo.update({ userId, revoked: false }, { revoked: true, revokedAt: new Date() });
  }

  async refreshTokens(refreshToken: string) {
    const stored = await this.refreshTokensRepo.findOne({
      where: { token: refreshToken, revoked: false },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepo.findOne({ where: { id: stored.userId, isActive: true } });
    if (!user) throw new UnauthorizedException('User not found');

    // Rotate: revoke old, issue new
    await this.refreshTokensRepo.update(stored.id, { revoked: true, revokedAt: new Date() });
    return this.generateTokens(user);
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      orgId: user.organizationId,
      role: user.role,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
    });

    const rawRefresh = randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.refreshTokensRepo.save({
      userId: user.id,
      organizationId: user.organizationId,
      token: rawRefresh,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken: rawRefresh,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }
}
```

- [ ] **Step 7: Create auth.controller.ts**

```typescript
import { Controller, Post, Body, HttpCode, HttpStatus, Headers, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';
import { ExtractJwt } from 'passport-jwt';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new organization + admin user' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  async logout(@CurrentUser() user: User, @Req() req: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    return this.authService.logout(user.id, token!);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange refresh token for new access token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }
}
```

- [ ] **Step 8: Create auth.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { Subscription } from '../../database/entities/subscription.entity';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') },
      }),
    }),
    TypeOrmModule.forFeature([User, Organization, RefreshToken, Subscription]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 9: Run e2e tests and verify they pass**

```bash
cd apps/api && pnpm test:e2e -- --testPathPattern=auth
```

Expected: All auth tests PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/auth/ apps/api/test/auth.e2e-spec.ts
git commit -m "feat(api): implement auth module with JWT, refresh tokens, and blacklisting"
```

---

## Task 6: Organizations and Users Modules

**Files:**
- Create: `apps/api/src/modules/organizations/organizations.service.ts`
- Create: `apps/api/src/modules/organizations/organizations.controller.ts`
- Create: `apps/api/src/modules/organizations/organizations.module.ts`
- Create: `apps/api/src/modules/organizations/dto/update-organization.dto.ts`
- Create: `apps/api/src/modules/users/users.service.ts`
- Create: `apps/api/src/modules/users/users.controller.ts`
- Create: `apps/api/src/modules/users/users.module.ts`
- Create: `apps/api/src/modules/users/dto/invite-user.dto.ts`
- Create: `apps/api/src/modules/users/dto/update-user.dto.ts`

- [ ] **Step 1: Write failing e2e test for organizations**

Create `apps/api/test/organizations.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Organizations (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Register and login to get token
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
      organizationName: 'Test Org',
      firstName: 'Admin',
      lastName: 'User',
      email: `admin-${Date.now()}@test.com`,
      password: 'Password123!',
    });
    accessToken = res.body.data.accessToken;
  });

  afterAll(() => app.close());

  it('GET /api/v1/organizations/me — returns current org', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('name', 'Test Org');
  });

  it('PATCH /api/v1/organizations/me — updates org name', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Updated Org Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Org Name');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && pnpm test:e2e -- --testPathPattern=organizations
```

Expected: FAIL — module not implemented.

- [ ] **Step 3: Create update-organization.dto.ts**

```typescript
import { IsString, IsOptional, MinLength, MaxLength, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  logoUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  website?: string;
}
```

- [ ] **Step 4: Create organizations.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from '../../database/entities/organization.entity';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(@InjectRepository(Organization) private orgsRepo: Repository<Organization>) {}

  async findById(id: string): Promise<Organization> {
    const org = await this.orgsRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto): Promise<Organization> {
    await this.orgsRepo.update(id, { ...dto });
    return this.findById(id);
  }
}
```

- [ ] **Step 5: Create organizations.controller.ts**

```typescript
import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current organization' })
  getMyOrg(@CurrentUser() user: User) {
    return this.orgsService.findById(user.organizationId);
  }

  @Patch('me')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update current organization (admin only)' })
  updateMyOrg(@CurrentUser() user: User, @Body() dto: UpdateOrganizationDto) {
    return this.orgsService.update(user.organizationId, dto);
  }
}
```

- [ ] **Step 6: Create organizations.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { Organization } from '../../database/entities/organization.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Organization])],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
```

- [ ] **Step 7: Create invite-user.dto.ts**

```typescript
import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../database/entities/user.entity';

export class InviteUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}
```

- [ ] **Step 8: Create update-user.dto.ts**

```typescript
import { IsOptional, IsString, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../../database/entities/user.entity';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
```

- [ ] **Step 9: Create users.service.ts**

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../../database/entities/user.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private usersRepo: Repository<User>) {}

  async findAll(organizationId: string): Promise<User[]> {
    return this.usersRepo.find({ where: { organizationId, isActive: true } });
  }

  async findById(id: string, organizationId: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id, organizationId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async invite(organizationId: string, invitedBy: string, dto: InviteUserDto): Promise<User> {
    const existing = await this.usersRepo.findOne({
      where: { email: dto.email.toLowerCase(), organizationId },
    });
    if (existing) throw new ConflictException('User already exists in this organization');

    // Invite creates user with temp password — they reset via email link
    const tempPassword = randomBytes(16).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = this.usersRepo.create({
      organizationId,
      email: dto.email.toLowerCase(),
      passwordHash,
      firstName: '',
      lastName: '',
      role: dto.role,
      invitedBy,
      emailVerified: false,
    });

    return this.usersRepo.save(user);
  }

  async update(id: string, organizationId: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id, organizationId);
    Object.assign(user, dto);
    return this.usersRepo.save(user);
  }

  async deactivate(id: string, organizationId: string, requestingUserId: string): Promise<void> {
    if (id === requestingUserId) throw new BadRequestException('Cannot deactivate your own account');
    await this.usersRepo.update({ id, organizationId }, { isActive: false });
  }
}
```

- [ ] **Step 10: Create users.controller.ts**

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List all users in organization' })
  findAll(@CurrentUser() user: User) {
    return this.usersService.findAll(user.organizationId);
  }

  @Post('invite')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Invite a new user to the organization' })
  invite(@CurrentUser() user: User, @Body() dto: InviteUserDto) {
    return this.usersService.invite(user.organizationId, user.id, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a user' })
  update(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, user.organizationId, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Deactivate a user' })
  deactivate(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deactivate(id, user.organizationId, user.id);
  }
}
```

- [ ] **Step 11: Create users.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from '../../database/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 12: Run all e2e tests**

```bash
cd apps/api && pnpm test:e2e
```

Expected: All tests PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/modules/organizations/ apps/api/src/modules/users/ apps/api/test/
git commit -m "feat(api): implement organizations and users modules"
```

---

## Task 7: Billing Module (Stripe)

**Files:**
- Create: `apps/api/src/modules/billing/billing.service.ts`
- Create: `apps/api/src/modules/billing/billing.controller.ts`
- Create: `apps/api/src/modules/billing/billing-webhook.controller.ts`
- Create: `apps/api/src/modules/billing/billing.module.ts`

- [ ] **Step 1: Create billing.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Organization } from '../../database/entities/organization.entity';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Subscription) private subsRepo: Repository<Subscription>,
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    private config: ConfigService,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' });
  }

  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return this.subsRepo.findOne({ where: { organizationId } });
  }

  async createCheckoutSession(organizationId: string, priceId: string, seats: number): Promise<{ url: string }> {
    let sub = await this.subsRepo.findOne({ where: { organizationId } });
    const org = await this.orgsRepo.findOne({ where: { id: organizationId } });

    let customerId = sub?.stripeCustomerId;

    if (!customerId) {
      const customer = await this.stripe.customers.create({ name: org!.name, metadata: { organizationId } });
      customerId = customer.id;

      if (sub) {
        await this.subsRepo.update(sub.id, { stripeCustomerId: customerId });
      }
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: seats }],
      success_url: `${this.config.get('APP_URL')}/settings/billing?success=true`,
      cancel_url: `${this.config.get('APP_URL')}/settings/billing?canceled=true`,
      metadata: { organizationId, seats: String(seats) },
    });

    return { url: session.url! };
  }

  async createPortalSession(organizationId: string): Promise<{ url: string }> {
    const sub = await this.subsRepo.findOne({ where: { organizationId } });
    if (!sub?.stripeCustomerId) throw new Error('No Stripe customer found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${this.config.get('APP_URL')}/settings/billing`,
    });

    return { url: session.url };
  }

  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(payload, signature, this.config.get('STRIPE_WEBHOOK_SECRET')!);
    } catch (err) {
      this.logger.error('Webhook signature verification failed', err);
      throw new Error('Invalid webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const { organizationId, seats } = session.metadata!;
        await this.subsRepo.update(
          { organizationId },
          {
            stripeSubscriptionId: session.subscription as string,
            stripeCustomerId: session.customer as string,
            status: SubscriptionStatus.ACTIVE,
            seats: parseInt(seats, 10),
          },
        );
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const sub = await this.subsRepo.findOne({ where: { stripeCustomerId: invoice.customer as string } });
        if (sub) await this.subsRepo.update(sub.id, { status: SubscriptionStatus.PAST_DUE });
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as Stripe.Subscription;
        const sub = await this.subsRepo.findOne({ where: { stripeSubscriptionId: stripeSub.id } });
        if (sub) await this.subsRepo.update(sub.id, { status: SubscriptionStatus.CANCELED, canceledAt: new Date() });
        break;
      }
      default:
        this.logger.log(`Unhandled webhook event: ${event.type}`);
    }
  }
}
```

- [ ] **Step 2: Create billing.controller.ts**

```typescript
import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNumber, Min } from 'class-validator';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

class CreateCheckoutDto {
  @IsString() priceId: string;
  @IsNumber() @Min(1) seats: number;
}

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('subscription')
  @ApiOperation({ summary: 'Get current subscription' })
  getSubscription(@CurrentUser() user: User) {
    return this.billingService.getSubscription(user.organizationId);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Create Stripe checkout session' })
  createCheckout(@CurrentUser() user: User, @Body() dto: CreateCheckoutDto) {
    return this.billingService.createCheckoutSession(user.organizationId, dto.priceId, dto.seats);
  }

  @Post('portal')
  @ApiOperation({ summary: 'Open Stripe billing portal' })
  createPortal(@CurrentUser() user: User) {
    return this.billingService.createPortalSession(user.organizationId);
  }
}
```

- [ ] **Step 3: Create billing-webhook.controller.ts**

```typescript
import { Controller, Post, Req, Headers, RawBodyRequest, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { BillingService } from './billing.service';

@ApiTags('Billing Webhooks')
@Controller('billing/webhook')
export class BillingWebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  @ApiOperation({ summary: 'Stripe webhook endpoint' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!req.rawBody) throw new BadRequestException('No raw body');
    await this.billingService.handleWebhook(req.rawBody, signature);
    return { received: true };
  }
}
```

- [ ] **Step 4: Create billing.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { Subscription } from '../../database/entities/subscription.entity';
import { Organization } from '../../database/entities/organization.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Organization])],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
```

- [ ] **Step 5: Enable raw body parsing in main.ts for Stripe webhooks**

Edit `apps/api/src/main.ts` — replace the `NestFactory.create` call:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['error', 'warn', 'log'],
  rawBody: true,   // ← add this
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/billing/
git commit -m "feat(api): implement billing module with Stripe checkout and webhooks"
```

---

## Task 8: Next.js Web App Bootstrap

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/tailwind.config.ts`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "web",
  "version": "0.0.1",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "next-auth": "^4.24.0",
    "axios": "^1.6.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "react-hook-form": "^7.48.0",
    "zod": "^3.22.0",
    "@hookform/resolvers": "^3.3.0",
    "sonner": "^1.3.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0",
    "lucide-react": "^0.300.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Install shadcn/ui**

```bash
cd apps/web
pnpm install
npx shadcn-ui@latest init
```

When prompted: TypeScript=yes, style=Default, base color=Slate, CSS variables=yes, tailwind config=tailwind.config.ts, components alias=@/components, utils alias=@/lib/utils.

- [ ] **Step 3: Add required shadcn components**

```bash
npx shadcn-ui@latest add button input label card form toast dropdown-menu avatar badge separator
```

- [ ] **Step 4: Create apps/web/lib/api.ts**

```typescript
import axios from 'axios';
import { getSession, signOut } from 'next-auth/react';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired — sign out and redirect to login
      await signOut({ callbackUrl: '/login' });
    }
    return Promise.reject(error);
  },
);

export default api;
```

- [ ] **Step 5: Create apps/web/lib/auth.ts**

```typescript
import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import axios from 'axios';

const API_URL = process.env.API_URL ?? 'http://localhost:3001/api/v1';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        try {
          const { data } = await axios.post(`${API_URL}/auth/login`, {
            email: credentials.email,
            password: credentials.password,
          });

          return {
            id: data.data.user.id,
            email: data.data.user.email,
            name: `${data.data.user.firstName} ${data.data.user.lastName}`,
            role: data.data.user.role,
            organizationId: data.data.user.organizationId,
            accessToken: data.data.accessToken,
            refreshToken: data.data.refreshToken,
          };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.role = (user as any).role;
        token.organizationId = (user as any).organizationId;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).role = token.role;
      (session as any).organizationId = token.organizationId;
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
```

- [ ] **Step 6: Create apps/web/app/api/auth/[...nextauth]/route.ts**

```typescript
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 7: Create apps/web/app/layout.tsx**

```typescript
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TimeChamp — Workforce Intelligence',
  description: 'Track time, monitor productivity, manage your team',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Create apps/web/app/providers.tsx**

```typescript
'use client';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000, retry: 1 } },
  }));

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
```

- [ ] **Step 9: Create apps/web/app/page.tsx**

```typescript
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect('/overview');
  redirect('/login');
}
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/
git commit -m "feat(web): bootstrap Next.js app with NextAuth, TanStack Query, shadcn/ui"
```

---

## Task 9: Auth Pages (Login + Register)

**Files:**
- Create: `apps/web/app/(auth)/layout.tsx`
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/register/page.tsx`
- Create: `apps/web/components/auth/login-form.tsx`
- Create: `apps/web/components/auth/register-form.tsx`

- [ ] **Step 1: Create apps/web/app/(auth)/layout.tsx**

```typescript
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md px-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create apps/web/components/auth/login-form.tsx**

```typescript
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    const result = await signIn('credentials', { ...data, redirect: false });

    if (result?.error) {
      toast.error('Invalid email or password');
      return;
    }

    toast.success('Welcome back!');
    router.push('/overview');
    router.refresh();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Sign in</CardTitle>
        <CardDescription>Enter your credentials to access your workspace</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@company.com" {...register('email')} />
            {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="••••••••" {...register('password')} />
            {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </Button>
          <p className="text-center text-sm text-slate-600">
            Don't have an account? <a href="/register" className="text-blue-600 hover:underline">Create workspace</a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create apps/web/app/(auth)/login/page.tsx**

```typescript
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return <LoginForm />;
}
```

- [ ] **Step 4: Create apps/web/components/auth/register-form.tsx**

```typescript
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  organizationName: z.string().min(2, 'Company name must be at least 2 characters'),
  firstName: z.string().min(1, 'Required'),
  lastName: z.string().min(1, 'Required'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type FormData = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/register`, data);
      await signIn('credentials', { email: data.email, password: data.password, redirect: false });
      toast.success('Workspace created! Welcome to TimeChamp.');
      router.push('/overview');
    } catch (err: any) {
      const message = err.response?.data?.message ?? 'Registration failed. Please try again.';
      toast.error(message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Create workspace</CardTitle>
        <CardDescription>Set up your organization on TimeChamp</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Company name</Label>
            <Input placeholder="Acme Corp" {...register('organizationName')} />
            {errors.organizationName && <p className="text-sm text-red-500">{errors.organizationName.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>First name</Label>
              <Input placeholder="John" {...register('firstName')} />
              {errors.firstName && <p className="text-sm text-red-500">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Last name</Label>
              <Input placeholder="Doe" {...register('lastName')} />
              {errors.lastName && <p className="text-sm text-red-500">{errors.lastName.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Work email</Label>
            <Input type="email" placeholder="you@company.com" {...register('email')} />
            {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input type="password" placeholder="Min 8 characters" {...register('password')} />
            {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Creating workspace...' : 'Create workspace'}
          </Button>
          <p className="text-center text-sm text-slate-600">
            Already have an account? <a href="/login" className="text-blue-600 hover:underline">Sign in</a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create apps/web/app/(auth)/register/page.tsx**

```typescript
import { RegisterForm } from '@/components/auth/register-form';

export default function RegisterPage() {
  return <RegisterForm />;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(auth\)/ apps/web/components/auth/
git commit -m "feat(web): add login and register pages"
```

---

## Task 10: Dashboard Shell (Sidebar + Header + Protected Layout)

**Files:**
- Create: `apps/web/components/dashboard/sidebar.tsx`
- Create: `apps/web/components/dashboard/header.tsx`
- Create: `apps/web/app/(dashboard)/layout.tsx`
- Create: `apps/web/app/(dashboard)/overview/page.tsx`
- Create: `apps/web/middleware.ts`

- [ ] **Step 1: Create apps/web/middleware.ts** (route protection)

```typescript
export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/(dashboard)/:path*',
    '/overview/:path*',
    '/employees/:path*',
    '/time-tracking/:path*',
    '/projects/:path*',
    '/gps/:path*',
    '/analytics/:path*',
    '/settings/:path*',
    '/alerts/:path*',
  ],
};
```

- [ ] **Step 2: Create apps/web/components/dashboard/sidebar.tsx**

```typescript
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Users, Clock, FolderKanban,
  MapPin, BarChart3, Plug, Bell, Settings,
} from 'lucide-react';

const navItems = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/employees', label: 'Employees', icon: Users },
  { href: '/time-tracking', label: 'Time Tracking', icon: Clock },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/gps', label: 'GPS & Field', icon: MapPin },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/settings/organization', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 min-h-screen bg-slate-900 text-white flex flex-col">
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold text-white">TimeChamp</h1>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Create apps/web/components/dashboard/header.tsx**

```typescript
'use client';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User } from 'lucide-react';

export function Header({ title }: { title: string }) {
  const { data: session } = useSession();
  const initials = session?.user?.name?.split(' ').map((n) => n[0]).join('') ?? 'U';

  return (
    <header className="h-16 border-b bg-white flex items-center justify-between px-6">
      <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-blue-600 text-white text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">{session?.user?.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <a href="/settings/organization"><User className="mr-2 h-4 w-4" />Settings</a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/login' })} className="text-red-600">
            <LogOut className="mr-2 h-4 w-4" />Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

- [ ] **Step 4: Create apps/web/app/(dashboard)/layout.tsx**

```typescript
import { Sidebar } from '@/components/dashboard/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Create apps/web/app/(dashboard)/overview/page.tsx**

```typescript
import { Header } from '@/components/dashboard/header';

export default function OverviewPage() {
  return (
    <>
      <Header title="Overview" />
      <div className="flex-1 p-6">
        <div className="rounded-lg border bg-white p-8 text-center text-slate-500">
          Live team activity will appear here once employees install the desktop agent.
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Start both apps and verify end-to-end flow**

```bash
# Terminal 1
docker compose up -d

# Terminal 2
cd apps/api && cp ../../.env.example .env && pnpm dev

# Terminal 3
cd apps/web && pnpm dev
```

Open http://localhost:3000 — should redirect to `/login`.
Register a workspace → should redirect to `/overview`.
Reload → should stay on `/overview` (session persists).
Click sign out → should redirect to `/login`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add dashboard shell with sidebar, header, and route protection"
```

---

## Task 11: Settings Pages (Organization, Users, Billing)

**Files:**
- Create: `apps/web/app/(dashboard)/settings/organization/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/users/page.tsx`
- Create: `apps/web/app/(dashboard)/settings/billing/page.tsx`
- Create: `apps/web/hooks/use-organization.ts`

- [ ] **Step 1: Create apps/web/hooks/use-organization.ts**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

export function useOrganization() {
  return useQuery({
    queryKey: ['organization'],
    queryFn: async () => {
      const { data } = await api.get('/organizations/me');
      return data.data;
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name?: string; timezone?: string; website?: string }) => {
      const { data } = await api.patch('/organizations/me', payload);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization'] });
      toast.success('Organization updated');
    },
    onError: () => toast.error('Failed to update organization'),
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get('/users');
      return data.data;
    },
  });
}

export function useInviteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { email: string; role: string }) => {
      const { data } = await api.post('/users/invite', payload);
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Invitation sent');
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Failed to invite user'),
  });
}

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      const { data } = await api.get('/billing/subscription');
      return data.data;
    },
  });
}
```

- [ ] **Step 2: Create organization settings page**

Create `apps/web/app/(dashboard)/settings/organization/page.tsx`:

```typescript
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect } from 'react';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrganization, useUpdateOrganization } from '@/hooks/use-organization';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  timezone: z.string().optional(),
  website: z.string().url('Must be a valid URL').optional().or(z.literal('')),
});

type FormData = z.infer<typeof schema>;

export default function OrganizationSettingsPage() {
  const { data: org, isLoading } = useOrganization();
  const { mutate: update, isPending } = useUpdateOrganization();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (org) reset({ name: org.name, timezone: org.timezone ?? '', website: org.website ?? '' });
  }, [org, reset]);

  if (isLoading) return <><Header title="Settings" /><div className="p-6">Loading...</div></>;

  return (
    <>
      <Header title="Organization Settings" />
      <div className="p-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Organization details</CardTitle>
            <CardDescription>Update your organization information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((data) => update(data))} className="space-y-4">
              <div className="space-y-2">
                <Label>Organization name</Label>
                <Input {...register('name')} />
                {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Input placeholder="UTC" {...register('timezone')} />
              </div>
              <div className="space-y-2">
                <Label>Website</Label>
                <Input placeholder="https://yourcompany.com" {...register('website')} />
                {errors.website && <p className="text-sm text-red-500">{errors.website.message}</p>}
              </div>
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save changes'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Create users settings page**

Create `apps/web/app/(dashboard)/settings/users/page.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useUsers, useInviteUser } from '@/hooks/use-organization';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'employee']),
});

type InviteData = z.infer<typeof inviteSchema>;

export default function UsersSettingsPage() {
  const { data: users = [], isLoading } = useUsers();
  const { mutate: invite, isPending } = useInviteUser();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<InviteData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { role: 'employee' },
  });

  const onInvite = (data: InviteData) => {
    invite(data, { onSuccess: () => { reset(); setShowInviteForm(false); } });
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = { admin: 'bg-red-100 text-red-700', manager: 'bg-blue-100 text-blue-700', employee: 'bg-green-100 text-green-700' };
    return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[role] ?? ''}`}>{role}</span>;
  };

  return (
    <>
      <Header title="Users" />
      <div className="p-6 max-w-4xl space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Team members ({users.length})</h3>
          <Button onClick={() => setShowInviteForm(!showInviteForm)}>Invite user</Button>
        </div>

        {showInviteForm && (
          <Card>
            <CardHeader><CardTitle className="text-base">Invite a team member</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onInvite)} className="flex gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <Label>Email</Label>
                  <Input type="email" placeholder="colleague@company.com" {...register('email')} />
                  {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <select className="border rounded-md px-3 py-2 text-sm" {...register('role')}>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <Button type="submit" disabled={isPending}>{isPending ? 'Sending...' : 'Send invite'}</Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-slate-500">Loading users...</div>
            ) : (
              <table className="w-full">
                <thead className="border-b bg-slate-50">
                  <tr>
                    <th className="text-left p-4 text-sm font-medium text-slate-600">Name</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-600">Email</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-600">Role</th>
                    <th className="text-left p-4 text-sm font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: any) => (
                    <tr key={user.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="p-4 text-sm font-medium">{user.firstName} {user.lastName}</td>
                      <td className="p-4 text-sm text-slate-600">{user.email}</td>
                      <td className="p-4">{roleBadge(user.role)}</td>
                      <td className="p-4">
                        <span className={`text-xs ${user.isActive ? 'text-green-600' : 'text-slate-400'}`}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Create billing settings page**

Create `apps/web/app/(dashboard)/settings/billing/page.tsx`:

```typescript
'use client';
import { Header } from '@/components/dashboard/header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSubscription } from '@/hooks/use-organization';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function BillingPage() {
  const { data: sub, isLoading } = useSubscription();

  const openPortal = async () => {
    try {
      const { data } = await api.post('/billing/portal');
      window.location.href = data.data.url;
    } catch {
      toast.error('Failed to open billing portal');
    }
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = { active: 'bg-green-100 text-green-700', trialing: 'bg-blue-100 text-blue-700', past_due: 'bg-red-100 text-red-700', canceled: 'bg-slate-100 text-slate-600' };
    return colors[status] ?? '';
  };

  return (
    <>
      <Header title="Billing" />
      <div className="p-6 max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Subscription</CardTitle>
            <CardDescription>Manage your plan and payment details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-slate-500">Loading...</p>
            ) : sub ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium capitalize">{sub.plan ?? 'Starter'} plan</p>
                    <p className="text-sm text-slate-500">{sub.seats} seats</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(sub.status)}`}>
                    {sub.status.replace('_', ' ')}
                  </span>
                </div>
                {sub.currentPeriodEnd && (
                  <p className="text-sm text-slate-500">
                    Next renewal: {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  </p>
                )}
                <Button onClick={openPortal} variant="outline">Manage billing</Button>
              </>
            ) : (
              <p className="text-slate-500">No subscription found.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Verify full flow in browser**

1. Register at http://localhost:3000/register
2. Navigate to `/settings/organization` — update org name, save
3. Navigate to `/settings/users` — invite a user
4. Navigate to `/settings/billing` — subscription status shows

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(dashboard\)/settings/ apps/web/hooks/
git commit -m "feat(web): add settings pages for organization, users, and billing"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Multi-tenant SaaS ✓ (RLS, org_id on all tables, TenantMiddleware)
  - Auth (JWT, refresh tokens, blacklist, logout) ✓
  - Organization management ✓
  - User management with roles ✓
  - Billing (Stripe checkout, portal, webhooks) ✓
  - Web dashboard shell (login, register, sidebar, settings) ✓
  - Build order step 1 (Foundation) ✓

- [x] **Placeholder scan:** No TBD or TODO in any step. All code is complete.

- [x] **Type consistency:**
  - `JwtPayload.sub` = user id (string) — matches `User.id` (UUID)
  - `User.organizationId` used consistently across services
  - `useOrganization()` → `api.get('/organizations/me')` matches controller route `GET /organizations/me`
  - `useInviteUser()` → `api.post('/users/invite')` matches `POST /users/invite`
  - Subscription `status` enum values match between entity and frontend display

- [x] **Scope:** Foundation sub-project only. Produces working login, registration, org settings, user management, billing. Next plan covers Desktop Agent (sub-project 2).
