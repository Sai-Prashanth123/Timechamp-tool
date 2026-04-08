# SP1 — Foundation: Email Flows + Web Auth Pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Foundation — add email verification, invite email, and password reset flows to the backend, then add the three missing web auth pages and the email verification banner.

**Architecture:** A new `TokenService` generates cryptographically secure tokens stored in Redis with TTL. `MailerService` gains three template methods. `AuthService` gains five new methods. `UsersService.invite()` sends the invite email. Three new Next.js pages handle accept-invite, forgot-password, and reset-password.

**Tech Stack:** NestJS, Redis (ioredis), nodemailer (AWS SES), Next.js 14, React Hook Form, Zod, shadcn/ui

---

## File Map

**Create:**
- `apps/api/src/infrastructure/token/token.service.ts`
- `apps/api/src/infrastructure/token/token.service.spec.ts`
- `apps/api/src/modules/auth/dto/forgot-password.dto.ts`
- `apps/api/src/modules/auth/dto/reset-password.dto.ts`
- `apps/api/src/modules/auth/dto/accept-invite.dto.ts`
- `apps/web/app/(auth)/accept-invite/page.tsx`
- `apps/web/app/(auth)/forgot-password/page.tsx`
- `apps/web/app/(auth)/reset-password/page.tsx`
- `apps/web/components/auth/accept-invite-form.tsx`
- `apps/web/components/auth/forgot-password-form.tsx`
- `apps/web/components/auth/reset-password-form.tsx`
- `apps/web/components/dashboard/email-verification-banner.tsx`

**Modify:**
- `apps/api/src/infrastructure/mailer/mailer.service.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/auth.module.ts`
- `apps/api/src/modules/users/users.service.ts`
- `apps/api/src/modules/users/users.module.ts`
- `apps/api/src/app.module.ts`
- `apps/web/app/(dashboard)/layout.tsx`

---

## Task 1: Create TokenService

**Files:**
- Create: `apps/api/src/infrastructure/token/token.service.ts`
- Create: `apps/api/src/infrastructure/token/token.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/infrastructure/token/token.service.spec.ts
import { Test } from '@nestjs/testing';
import { TokenService } from './token.service';
import { RedisService } from '../redis/redis.service';

describe('TokenService', () => {
  let service: TokenService;
  let redis: jest.Mocked<Pick<RedisService, 'set' | 'get' | 'del'>>;

  beforeEach(async () => {
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = module.get(TokenService);
  });

  it('generate stores userId in Redis with correct TTL', async () => {
    redis.set.mockResolvedValue(undefined);
    const token = await service.generate('email-verify', 'user-123');
    expect(token).toHaveLength(64); // 32 bytes hex
    expect(redis.set).toHaveBeenCalledWith(
      `token:email-verify:${token}`,
      'user-123',
      86400,
    );
  });

  it('consume returns userId and deletes key', async () => {
    redis.get.mockResolvedValue('user-123');
    redis.del.mockResolvedValue(undefined);
    const result = await service.consume('invite', 'abc123');
    expect(result).toBe('user-123');
    expect(redis.del).toHaveBeenCalledWith('token:invite:abc123');
  });

  it('consume returns null for unknown token', async () => {
    redis.get.mockResolvedValue(null);
    const result = await service.consume('password-reset', 'bad-token');
    expect(result).toBeNull();
    expect(redis.del).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest token.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './token.service'`

- [ ] **Step 3: Create TokenService**

```typescript
// apps/api/src/infrastructure/token/token.service.ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { RedisService } from '../redis/redis.service';

export type TokenPurpose = 'email-verify' | 'invite' | 'password-reset';

const TTL: Record<TokenPurpose, number> = {
  'email-verify': 86400,    // 24 hours
  'invite': 259200,          // 72 hours
  'password-reset': 3600,   // 1 hour
};

@Injectable()
export class TokenService {
  constructor(private redis: RedisService) {}

  /** Generates a secure random token, stores userId → Redis, returns the token. */
  async generate(purpose: TokenPurpose, userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`token:${purpose}:${token}`, userId, TTL[purpose]);
    return token;
  }

  /**
   * Validates token and returns the stored userId.
   * Does NOT consume the token (use consume() for one-time tokens).
   */
  async peek(purpose: TokenPurpose, token: string): Promise<string | null> {
    return this.redis.get(`token:${purpose}:${token}`);
  }

  /**
   * Validates token, returns userId, and deletes the token (one-time use).
   * Returns null if token is invalid or expired.
   */
  async consume(purpose: TokenPurpose, token: string): Promise<string | null> {
    const key = `token:${purpose}:${token}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/api && npx jest token.service.spec --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/infrastructure/token/
git commit -m "feat(api): add TokenService for Redis-backed one-time tokens"
```

---

## Task 2: Add Email Template Methods to MailerService

**Files:**
- Modify: `apps/api/src/infrastructure/mailer/mailer.service.ts`

- [ ] **Step 1: Replace mailer.service.ts with full implementation**

```typescript
// apps/api/src/infrastructure/mailer/mailer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST', 'localhost'),
      port: this.config.get<number>('SMTP_PORT', 1025),
      secure: this.config.get<boolean>('SMTP_SECURE', false),
      auth:
        this.config.get('SMTP_USER')
          ? {
              user: this.config.get<string>('SMTP_USER'),
              pass: this.config.get<string>('SMTP_PASS'),
            }
          : undefined,
    });
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM', 'noreply@timechamp.io'),
        to,
        subject,
        html,
      });
    } catch (err) {
      // Email failures must not crash API requests
      this.logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
    }
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL')}/verify-email?token=${token}`;
    await this.send(
      to,
      'Please verify your email — TimeChamp',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Verify your email address</h2>
        <p style="color:#475569">Click the button below to verify your email. This link expires in 24 hours.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Verify email
        </a>
        <p style="color:#94a3b8;font-size:12px">Or paste this link: ${url}</p>
      </div>`,
    );
  }

  async sendInviteEmail(
    to: string,
    inviterName: string,
    orgName: string,
    token: string,
  ): Promise<void> {
    const url = `${this.config.get('APP_URL')}/accept-invite?token=${token}`;
    await this.send(
      to,
      `${inviterName} invited you to ${orgName} on TimeChamp`,
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">You've been invited!</h2>
        <p style="color:#475569"><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on TimeChamp.</p>
        <p style="color:#475569">Click the button to accept. This invitation expires in 72 hours.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Accept invitation
        </a>
        <p style="color:#94a3b8;font-size:12px">Or paste this link: ${url}</p>
      </div>`,
    );
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const url = `${this.config.get('APP_URL')}/reset-password?token=${token}`;
    await this.send(
      to,
      'Reset your TimeChamp password',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#1e293b">Reset your password</h2>
        <p style="color:#475569">Click the button to set a new password. This link expires in 1 hour.</p>
        <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
          Reset password
        </a>
        <p style="color:#94a3b8;font-size:12px">Or paste this link: ${url}</p>
        <p style="color:#94a3b8;font-size:12px">If you didn't request this, you can ignore this email.</p>
      </div>`,
    );
  }

  /** Generic send — kept for backward compatibility */
  async sendMail(options: { to: string; subject: string; html: string }): Promise<void> {
    await this.send(options.to, options.subject, options.html);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/infrastructure/mailer/mailer.service.ts
git commit -m "feat(api): add email template methods to MailerService"
```

---

## Task 3: Add Email Flows to AuthService

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/dto/forgot-password.dto.ts`
- Create: `apps/api/src/modules/auth/dto/reset-password.dto.ts`
- Create: `apps/api/src/modules/auth/dto/accept-invite.dto.ts`

- [ ] **Step 1: Create the DTOs**

```typescript
// apps/api/src/modules/auth/dto/forgot-password.dto.ts
import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@company.com' })
  @IsEmail()
  email: string;
}
```

```typescript
// apps/api/src/modules/auth/dto/reset-password.dto.ts
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewPassword123!' })
  @IsString()
  @MinLength(8)
  password: string;
}
```

```typescript
// apps/api/src/modules/auth/dto/accept-invite.dto.ts
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1)
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1)
  lastName: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(8)
  password: string;
}
```

- [ ] **Step 2: Write tests for new AuthService methods**

Add this file:

```typescript
// apps/api/src/modules/auth/auth.service.email-flows.spec.ts
import { Test } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { User, UserRole } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { Subscription } from '../../database/entities/subscription.entity';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  role: UserRole.ADMIN,
  organizationId: 'org-1',
  isActive: true,
  emailVerified: false,
  passwordHash: '$2b$12$invalid',
};

describe('AuthService — email flows', () => {
  let service: AuthService;
  let usersRepo: any;
  let tokenService: jest.Mocked<TokenService>;
  let mailerService: jest.Mocked<MailerService>;
  let redis: jest.Mocked<RedisService>;
  let refreshRepo: any;

  beforeEach(async () => {
    usersRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      }),
    };
    refreshRepo = { update: jest.fn(), save: jest.fn() };
    tokenService = {
      generate: jest.fn(),
      peek: jest.fn(),
      consume: jest.fn(),
    } as any;
    mailerService = {
      sendVerificationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
      sendInviteEmail: jest.fn(),
    } as any;
    redis = { set: jest.fn(), get: jest.fn(), del: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: getRepositoryToken(Organization), useValue: {} },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshRepo },
        { provide: getRepositoryToken(Subscription), useValue: {} },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('jwt') } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('mock') } },
        { provide: DataSource, useValue: {} },
        { provide: RedisService, useValue: redis },
        { provide: TokenService, useValue: tokenService },
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('sendVerificationEmail', () => {
    it('generates token and sends email', async () => {
      tokenService.generate.mockResolvedValue('tok123');
      await service.sendVerificationEmail('user-1', 'user@test.com');
      expect(tokenService.generate).toHaveBeenCalledWith('email-verify', 'user-1');
      expect(mailerService.sendVerificationEmail).toHaveBeenCalledWith('user@test.com', 'tok123');
    });
  });

  describe('verifyEmail', () => {
    it('marks email verified when token is valid', async () => {
      tokenService.consume.mockResolvedValue('user-1');
      usersRepo.findOne.mockResolvedValue(mockUser);
      await service.verifyEmail('valid-token');
      expect(usersRepo.update).toHaveBeenCalledWith('user-1', { emailVerified: true });
    });

    it('throws UnauthorizedException for invalid token', async () => {
      tokenService.consume.mockResolvedValue(null);
      await expect(service.verifyEmail('bad')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('forgotPassword', () => {
    it('sends reset email when user exists', async () => {
      usersRepo.findOne.mockResolvedValue(mockUser);
      tokenService.generate.mockResolvedValue('reset-tok');
      await service.forgotPassword('test@example.com');
      expect(mailerService.sendPasswordResetEmail).toHaveBeenCalledWith('test@example.com', 'reset-tok');
    });

    it('silently succeeds when user not found (prevents email enumeration)', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
      expect(mailerService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates password hash when token is valid', async () => {
      tokenService.consume.mockResolvedValue('user-1');
      usersRepo.findOne.mockResolvedValue(mockUser);
      refreshRepo.update.mockResolvedValue({});
      await service.resetPassword('valid-token', 'NewPass123!');
      expect(usersRepo.update).toHaveBeenCalledWith('user-1', expect.objectContaining({ passwordHash: expect.any(String) }));
      expect(refreshRepo.update).toHaveBeenCalledWith({ userId: 'user-1' }, { revoked: true, revokedAt: expect.any(Date) });
    });

    it('throws UnauthorizedException for invalid token', async () => {
      tokenService.consume.mockResolvedValue(null);
      await expect(service.resetPassword('bad', 'pass')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('acceptInvite', () => {
    it('sets name, password, emailVerified on valid token', async () => {
      tokenService.consume.mockResolvedValue('user-1');
      usersRepo.findOne.mockResolvedValue(mockUser);
      refreshRepo.save.mockResolvedValue({});
      await service.acceptInvite('valid-token', 'Jane', 'Doe', 'pass12345678');
      expect(usersRepo.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ firstName: 'Jane', lastName: 'Doe', emailVerified: true }),
      );
    });

    it('throws UnauthorizedException for invalid token', async () => {
      tokenService.consume.mockResolvedValue(null);
      await expect(service.acceptInvite('bad', 'A', 'B', 'pass')).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/api && npx jest auth.service.email-flows.spec --no-coverage
```

Expected: FAIL — methods not found on AuthService

- [ ] **Step 4: Add email flow methods to AuthService**

Add the following methods to the existing `AuthService` class in `apps/api/src/modules/auth/auth.service.ts`. First add the new imports and constructor parameters, then add the methods.

**Add to imports:**
```typescript
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
```

**Add to constructor parameters:**
```typescript
private tokenService: TokenService,
private mailer: MailerService,
```

**Add these methods to the class (after `refreshTokens`):**
```typescript
async sendVerificationEmail(userId: string, email: string): Promise<void> {
  const token = await this.tokenService.generate('email-verify', userId);
  await this.mailer.sendVerificationEmail(email, token);
}

async verifyEmail(token: string): Promise<void> {
  const userId = await this.tokenService.consume('email-verify', token);
  if (!userId) throw new UnauthorizedException('Invalid or expired verification link');
  await this.usersRepo.update(userId, { emailVerified: true });
}

async resendVerification(userId: string, email: string): Promise<void> {
  await this.sendVerificationEmail(userId, email);
}

async forgotPassword(email: string): Promise<void> {
  const user = await this.usersRepo.findOne({
    where: { email: email.toLowerCase(), isActive: true },
  });
  // Silently succeed even if user not found — prevents email enumeration
  if (!user) return;
  const token = await this.tokenService.generate('password-reset', user.id);
  await this.mailer.sendPasswordResetEmail(email, token);
}

async resetPassword(token: string, newPassword: string): Promise<void> {
  const userId = await this.tokenService.consume('password-reset', token);
  if (!userId) throw new UnauthorizedException('Invalid or expired reset link');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await this.usersRepo.update(userId, { passwordHash });
  // Invalidate all sessions so old tokens can't be used
  await this.refreshTokensRepo.update(
    { userId, revoked: false },
    { revoked: true, revokedAt: new Date() },
  );
}

async acceptInvite(
  token: string,
  firstName: string,
  lastName: string,
  password: string,
): Promise<ReturnType<AuthService['generateTokens']>> {
  const userId = await this.tokenService.consume('invite', token);
  if (!userId) throw new UnauthorizedException('Invalid or expired invite link');
  const user = await this.usersRepo.findOne({ where: { id: userId, isActive: true } });
  if (!user) throw new UnauthorizedException('User not found');
  const passwordHash = await bcrypt.hash(password, 12);
  await this.usersRepo.update(userId, { firstName, lastName, passwordHash, emailVerified: true });
  const updatedUser = { ...user, firstName, lastName, emailVerified: true };
  return this.generateTokens(updatedUser as User);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/api && npx jest auth.service.email-flows.spec --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat(api): add email verification, forgot password, accept invite to AuthService"
```

---

## Task 4: Add New Endpoints to AuthController

**Files:**
- Modify: `apps/api/src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Replace auth.controller.ts with full version**

```typescript
// apps/api/src/modules/auth/auth.controller.ts
import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExtractJwt } from 'passport-jwt';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../../database/entities/user.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new organization + admin user' })
  async register(@Body() dto: RegisterDto) {
    const result = await this.authService.register(dto);
    // Send verification email after registration (non-blocking)
    this.authService
      .sendVerificationEmail(result.user.id, result.user.email)
      .catch(() => void 0);
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke tokens' })
  logout(@CurrentUser() user: User, @Req() req: any) {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req) as string;
    return this.authService.logout(user.id, token);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshTokens(refreshToken);
  }

  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email address using token from email link' })
  async verifyEmail(@Query('token') token: string) {
    await this.authService.verifyEmail(token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend verification email' })
  async resendVerification(@CurrentUser() user: User) {
    await this.authService.resendVerification(user.id, user.email);
    return { message: 'Verification email sent' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If that email exists, a reset link has been sent' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password reset successfully' };
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept team invitation, set name and password' })
  acceptInvite(@Body() dto: AcceptInviteDto) {
    return this.authService.acceptInvite(
      dto.token,
      dto.firstName,
      dto.lastName,
      dto.password,
    );
  }
}
```

- [ ] **Step 2: Update AuthModule to provide TokenService**

```typescript
// apps/api/src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Organization, RefreshToken, Subscription]),
    PassportModule,
    JwtModule.register({}),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TokenService, MailerService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/
git commit -m "feat(api): add email flow endpoints to AuthController, wire TokenService into AuthModule"
```

---

## Task 5: Make UsersService.invite() Send Invite Email

**Files:**
- Modify: `apps/api/src/modules/users/users.service.ts`
- Modify: `apps/api/src/modules/users/users.module.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/users/users.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { User, UserRole } from '../../database/entities/user.entity';

describe('UsersService', () => {
  let service: UsersService;
  let usersRepo: any;
  let tokenService: jest.Mocked<TokenService>;
  let mailerService: jest.Mocked<MailerService>;

  beforeEach(async () => {
    usersRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    tokenService = { generate: jest.fn() } as any;
    mailerService = { sendInviteEmail: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: usersRepo },
        { provide: TokenService, useValue: tokenService },
        { provide: MailerService, useValue: mailerService },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('invite', () => {
    it('creates user and sends invite email', async () => {
      usersRepo.findOne.mockResolvedValue(null);
      const savedUser = { id: 'u1', email: 'new@test.com', organizationId: 'org1', role: UserRole.EMPLOYEE };
      usersRepo.create.mockReturnValue(savedUser);
      usersRepo.save.mockResolvedValue(savedUser);
      tokenService.generate.mockResolvedValue('invite-token-abc');
      mailerService.sendInviteEmail.mockResolvedValue(undefined);

      const result = await service.invite('org1', 'inviter1', { email: 'new@test.com', role: UserRole.EMPLOYEE }, 'Inviter Name');

      expect(result).toEqual(savedUser);
      expect(tokenService.generate).toHaveBeenCalledWith('invite', 'u1');
      expect(mailerService.sendInviteEmail).toHaveBeenCalledWith(
        'new@test.com', 'Inviter Name', expect.any(String), 'invite-token-abc',
      );
    });

    it('throws ConflictException if email already exists', async () => {
      usersRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.invite('org1', 'inv1', { email: 'exists@test.com', role: UserRole.EMPLOYEE }, 'Admin'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api && npx jest users.service.spec --no-coverage
```

Expected: FAIL — invite() doesn't accept inviterName param or send email

- [ ] **Step 3: Update UsersService**

Replace `apps/api/src/modules/users/users.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../../database/entities/user.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private tokenService: TokenService,
    private mailer: MailerService,
  ) {}

  async findAll(organizationId: string): Promise<User[]> {
    return this.usersRepo.find({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string, organizationId: string): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id, organizationId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async invite(
    organizationId: string,
    invitedBy: string,
    dto: InviteUserDto,
    inviterName: string,
  ): Promise<User> {
    const existing = await this.usersRepo.findOne({
      where: { email: dto.email.toLowerCase(), organizationId },
    });
    if (existing) {
      throw new ConflictException('A user with this email already exists in the organization');
    }

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

    const savedUser = await this.usersRepo.save(user);

    // Generate invite token and send email (non-blocking — don't fail if email fails)
    this.tokenService
      .generate('invite', savedUser.id)
      .then((token) =>
        this.mailer.sendInviteEmail(savedUser.email, inviterName, organizationId, token),
      )
      .catch(() => void 0);

    return savedUser;
  }

  async update(id: string, organizationId: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id, organizationId);
    Object.assign(user, dto);
    return this.usersRepo.save(user);
  }

  async deactivate(id: string, organizationId: string, requestingUserId: string): Promise<void> {
    if (id === requestingUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.findById(id, organizationId);
    await this.usersRepo.update(user.id, { isActive: false });
  }
}
```

- [ ] **Step 4: Update UsersController to pass inviterName**

In `apps/api/src/modules/users/users.controller.ts`, update the `invite` method:

```typescript
// Change this:
invite(@CurrentUser() user: User, @Body() dto: InviteUserDto) {
  return this.usersService.invite(user.organizationId, user.id, dto);
}

// To this:
invite(@CurrentUser() user: User, @Body() dto: InviteUserDto) {
  const inviterName = `${user.firstName} ${user.lastName}`.trim() || user.email;
  return this.usersService.invite(user.organizationId, user.id, dto, inviterName);
}
```

- [ ] **Step 5: Update UsersModule**

```typescript
// apps/api/src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from '../../database/entities/user.entity';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), RedisModule],
  controllers: [UsersController],
  providers: [UsersService, TokenService, MailerService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api && npx jest users.service.spec --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/users/
git commit -m "feat(api): UsersService.invite() now sends invite email via TokenService"
```

---

## Task 6: Update app.module.ts Joi Schema

**Files:**
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Add SMTP env vars to validation schema**

In `apps/api/src/app.module.ts`, add these fields to the `validationSchema` Joi object:

```typescript
// Add after existing keys in the Joi.object({...}):
SMTP_HOST: Joi.string().default('localhost'),
SMTP_PORT: Joi.number().default(1025),
SMTP_SECURE: Joi.boolean().default(false),
SMTP_USER: Joi.string().optional(),
SMTP_PASS: Joi.string().optional(),
SMTP_FROM: Joi.string().email().default('noreply@timechamp.io'),
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/app.module.ts
git commit -m "chore(api): add SMTP env vars to Joi validation schema"
```

---

## Task 7: Web — Accept Invite Page

**Files:**
- Create: `apps/web/app/(auth)/accept-invite/page.tsx`
- Create: `apps/web/components/auth/accept-invite-form.tsx`

- [ ] **Step 1: Create accept-invite-form component**

```typescript
// apps/web/components/auth/accept-invite-form.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z
  .object({
    firstName: z.string().min(1, 'First name is required'),
    lastName: z.string().min(1, 'Last name is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    try {
      const res = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/accept-invite`,
        { token, firstName: data.firstName, lastName: data.lastName, password: data.password },
      );
      const email = res.data?.data?.user?.email;
      if (email) {
        const result = await signIn('credentials', {
          email,
          password: data.password,
          redirect: false,
        });
        if (result?.error) {
          router.push('/login');
          return;
        }
      }
      toast.success('Welcome to TimeChamp!');
      router.push('/overview');
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message ?? 'Invalid or expired invite link.'
        : 'Something went wrong.';
      toast.error(message);
    }
  };

  if (!token) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500 text-sm">Invalid invite link. Please ask your admin to resend the invitation.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Accept invitation</CardTitle>
        <CardDescription>Set up your TimeChamp account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input id="firstName" placeholder="Jane" autoComplete="given-name" {...register('firstName')} />
              {errors.firstName && <p className="text-sm text-red-500">{errors.firstName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" placeholder="Doe" autoComplete="family-name" {...register('lastName')} />
              {errors.lastName && <p className="text-sm text-red-500">{errors.lastName.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" placeholder="Min 8 characters" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <Input id="confirmPassword" type="password" placeholder="Repeat password" autoComplete="new-password" {...register('confirmPassword')} />
            {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Setting up account...' : 'Create account'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create accept-invite page**

```typescript
// apps/web/app/(auth)/accept-invite/page.tsx
import { Suspense } from 'react';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading...</div>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\(auth\)/accept-invite/ apps/web/components/auth/accept-invite-form.tsx
git commit -m "feat(web): add accept-invite page"
```

---

## Task 8: Web — Forgot Password + Reset Password Pages

**Files:**
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/components/auth/forgot-password-form.tsx`
- Create: `apps/web/components/auth/reset-password-form.tsx`

- [ ] **Step 1: Create forgot-password-form**

```typescript
// apps/web/components/auth/forgot-password-form.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({ email: z.string().email('Please enter a valid email') });
type FormData = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    await axios
      .post(`${process.env.NEXT_PUBLIC_API_URL}/auth/forgot-password`, data)
      .catch(() => void 0); // always show success — prevents email enumeration
    setSent(true);
  };

  if (sent) {
    return (
      <Card>
        <CardContent className="pt-6 text-center space-y-2">
          <p className="text-2xl">📧</p>
          <p className="font-medium text-slate-800">Check your inbox</p>
          <p className="text-sm text-slate-500">If that email exists, we've sent a reset link. It expires in 1 hour.</p>
          <a href="/login" className="text-sm text-blue-600 hover:underline">Back to sign in</a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Forgot password</CardTitle>
        <CardDescription>Enter your email and we'll send a reset link</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="you@company.com" autoComplete="email" {...register('email')} />
            {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send reset link'}
          </Button>
          <p className="text-center text-sm text-slate-600">
            <a href="/login" className="text-blue-600 hover:underline">Back to sign in</a>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create reset-password-form**

```typescript
// apps/web/components/auth/reset-password-form.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import axios from 'axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await axios.post(`${process.env.NEXT_PUBLIC_API_URL}/auth/reset-password`, {
        token,
        password: data.password,
      });
      toast.success('Password reset! Please sign in.');
      router.push('/login');
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message ?? 'Invalid or expired reset link.'
        : 'Something went wrong.';
      toast.error(message);
    }
  };

  if (!token) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500 text-sm">Invalid reset link. Please request a new one.</p>
          <a href="/forgot-password" className="text-sm text-blue-600 hover:underline mt-2 block">Request new link</a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>Choose a new password for your account</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" type="password" placeholder="Min 8 characters" autoComplete="new-password" {...register('password')} />
            {errors.password && <p className="text-sm text-red-500">{errors.password.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" type="password" placeholder="Repeat password" autoComplete="new-password" {...register('confirmPassword')} />
            {errors.confirmPassword && <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting...' : 'Reset password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create the two page files**

```typescript
// apps/web/app/(auth)/forgot-password/page.tsx
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
```

```typescript
// apps/web/app/(auth)/reset-password/page.tsx
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(auth\)/forgot-password/ apps/web/app/\(auth\)/reset-password/ apps/web/components/auth/forgot-password-form.tsx apps/web/components/auth/reset-password-form.tsx
git commit -m "feat(web): add forgot-password and reset-password pages"
```

---

## Task 9: Web — Email Verification Banner in Dashboard

**Files:**
- Create: `apps/web/components/dashboard/email-verification-banner.tsx`
- Modify: `apps/web/app/(dashboard)/layout.tsx`

- [ ] **Step 1: Create the banner component**

```typescript
// apps/web/components/dashboard/email-verification-banner.tsx
'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import api from '@/lib/api';

export function EmailVerificationBanner() {
  const { data: session } = useSession();
  const [resending, setResending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const emailVerified = (session as any)?.user?.emailVerified as boolean | undefined;

  if (emailVerified || dismissed) return null;

  const resend = async () => {
    setResending(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success('Verification email sent! Check your inbox.');
    } catch {
      toast.error('Failed to send. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-sm">
      <span className="text-amber-800">
        Please verify your email address to unlock all features.
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={resend}
          disabled={resending}
          className="text-amber-700 font-medium hover:text-amber-900 disabled:opacity-50"
        >
          {resending ? 'Sending...' : 'Resend email'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-700"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add banner to dashboard layout**

```typescript
// apps/web/app/(dashboard)/layout.tsx
import { Sidebar } from '@/components/dashboard/sidebar';
import { EmailVerificationBanner } from '@/components/dashboard/email-verification-banner';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <EmailVerificationBanner />
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify emailVerified is in the JWT session**

Check `apps/web/app/api/auth/[...nextauth]/route.ts` — the session callback should include `emailVerified`. If it doesn't, add it:

```typescript
// In the session callback, make sure to include emailVerified:
callbacks: {
  async session({ session, token }) {
    if (token) {
      (session as any).accessToken = token.accessToken;
      (session.user as any).id = token.sub;
      (session.user as any).role = token.role;
      (session.user as any).organizationId = token.organizationId;
      (session.user as any).emailVerified = token.emailVerified; // add this line
    }
    return session;
  },
  async jwt({ token, user }) {
    if (user) {
      token.accessToken = (user as any).accessToken;
      token.role = (user as any).role;
      token.organizationId = (user as any).organizationId;
      token.emailVerified = (user as any).emailVerified; // add this line
    }
    return token;
  },
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/dashboard/email-verification-banner.tsx apps/web/app/\(dashboard\)/layout.tsx apps/web/app/api/
git commit -m "feat(web): add email verification banner to dashboard layout"
```

---

## Task 10: Verify the Full SP1 Flow Works

- [ ] **Step 1: Run all API tests**

```bash
cd apps/api && npx jest --no-coverage
```

Expected: All tests PASS

- [ ] **Step 2: Start API locally and test flows with curl**

```bash
# Start the API
cd apps/api && npm run start:dev
```

```bash
# Test 1: Register
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"organizationName":"Test Corp","firstName":"Admin","lastName":"User","email":"admin@test.com","password":"password123"}'
# Expected: 201 with accessToken + user object

# Test 2: Login
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123"}'
# Expected: 200 with accessToken

# Test 3: Forgot password (should succeed silently for non-existent email too)
curl -X POST http://localhost:3001/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com"}'
# Expected: 200 with message
```

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: SP1 Foundation complete — email flows, invite, password reset, web auth pages"
```

SP1 is complete. Proceed to SP2 plan: `docs/superpowers/plans/2026-04-08-sp2-agent-sync.md`
