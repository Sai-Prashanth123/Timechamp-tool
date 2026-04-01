import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../database/entities/user.entity';
import { RedisService } from '../../../infrastructure/redis/redis.service';

export interface JwtPayload {
  sub: string;
  orgId: string;
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
      secretOrKey: config.get<string>('JWT_SECRET')!,
      passReqToCallback: true,
    });
  }

  async validate(req: any, payload: JwtPayload): Promise<User> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req) as string;

    const isBlacklisted = await this.redis.exists(`blacklist:${token}`);
    if (isBlacklisted) throw new UnauthorizedException('Token has been revoked');

    const user = await this.usersRepo.findOne({
      where: {
        id: payload.sub,
        organizationId: payload.orgId,
        isActive: true,
      },
    });

    if (!user) throw new UnauthorizedException('User not found or inactive');
    return user;
  }
}
