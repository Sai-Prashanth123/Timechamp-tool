import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User, UserRole } from '../../database/entities/user.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RefreshToken } from '../../database/entities/refresh-token.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { TokenService } from '../../infrastructure/token/token.service';
import { MailerService } from '../../infrastructure/mailer/mailer.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(Organization) private orgsRepo: Repository<Organization>,
    @InjectRepository(RefreshToken)
    private refreshTokensRepo: Repository<RefreshToken>,
    @InjectRepository(Subscription) private subsRepo: Repository<Subscription>,
    private jwtService: JwtService,
    private config: ConfigService,
    private redis: RedisService,
    private dataSource: DataSource,
    private tokenService: TokenService,
    private mailerService: MailerService,
  ) {}

  async register(dto: RegisterDto) {
    const slug =
      dto.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') +
      '-' +
      randomBytes(3).toString('hex');

    const newUser = await this.dataSource.transaction(async (manager) => {
      const existingSlug = await manager.findOne(Organization, {
        where: { slug },
      });
      if (existingSlug) throw new ConflictException('Please try again');

      // Check for existing user with same email (globally — emails are unique per user identity)
      const existingEmail = await manager.findOne(User, {
        where: { email: dto.email.toLowerCase() },
      });
      if (existingEmail) {
        throw new ConflictException(
          'An account with this email already exists. Please log in instead.',
        );
      }

      const org = manager.create(Organization, {
        name: dto.organizationName,
        slug,
      });
      await manager.save(org);

      const sub = manager.create(Subscription, { organizationId: org.id });
      await manager.save(sub);

      const passwordHash = await bcrypt.hash(dto.password, 12);

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

      return user;
    });

    return this.generateTokens(newUser);
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('LOWER(user.email) = LOWER(:email)', { email: dto.email })
      .andWhere('user.isActive = true')
      .getOne();

    // Always run bcrypt.compare to prevent timing-based email enumeration
    const DUMMY_HASH =
      '$2b$12$invalidhashfortimingnormalizationonly00000000000000000000';
    const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(dto.password, hashToCompare);

    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    return this.generateTokens(user);
  }

  async logout(userId: string, accessToken: string): Promise<void> {
    // Blacklist access token for remaining 15-min window
    await this.redis.set(`blacklist:${accessToken}`, '1', 15 * 60);
    // Revoke all refresh tokens for this user
    await this.refreshTokensRepo.update(
      { userId, revoked: false },
      { revoked: true, revokedAt: new Date() },
    );
  }

  async refreshTokens(refreshToken: string) {
    const stored = await this.refreshTokensRepo.findOne({
      where: { token: refreshToken, revoked: false },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepo.findOne({
      where: { id: stored.userId, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    // Rotate: revoke old token, issue new pair
    await this.refreshTokensRepo.update(stored.id, {
      revoked: true,
      revokedAt: new Date(),
    });

    return this.generateTokens(user);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.tokenService.consume('email-verify', token);
    if (!userId) throw new BadRequestException('Invalid or expired verification token');
    await this.usersRepo.update(userId, { emailVerified: true });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.emailVerified) return; // already verified, silently succeed
    const token = await this.tokenService.generate('email-verify', userId);
    await this.mailerService.sendVerificationEmail(user.email, token);
  }

  async forgotPassword(email: string): Promise<void> {
    // Silently succeed even if email not found (prevent enumeration)
    const user = await this.usersRepo.findOne({ where: { email } });
    if (!user) return;
    const token = await this.tokenService.generate('password-reset', user.id);
    await this.mailerService.sendPasswordResetEmail(user.email, token);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokenService.consume('password-reset', token);
    if (!userId) throw new BadRequestException('Invalid or expired reset token');
    const hashed = await bcrypt.hash(newPassword, 12);
    await this.usersRepo.update(userId, { passwordHash: hashed });
    // Invalidate all refresh tokens for this user
    await this.refreshTokensRepo.delete({ userId });
  }

  async acceptInvite(
    token: string,
    firstName: string,
    lastName: string,
    password: string,
  ): Promise<void> {
    const userId = await this.tokenService.consume('invite', token);
    if (!userId) throw new BadRequestException('Invalid or expired invite token');
    const hashed = await bcrypt.hash(password, 12);
    await this.usersRepo.update(userId, {
      firstName,
      lastName,
      passwordHash: hashed,
      emailVerified: true,
    });
  }

  private async generateTokens(user: User) {
    const payload: JwtPayload = {
      sub: user.id,
      orgId: user.organizationId,
      role: user.role,
      email: user.email,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '15m'),
    });

    const rawRefresh = randomBytes(40).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
