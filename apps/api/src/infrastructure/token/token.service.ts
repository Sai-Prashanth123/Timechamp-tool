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

  async generate(purpose: TokenPurpose, userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`token:${purpose}:${token}`, userId, TTL[purpose]);
    return token;
  }

  async peek(purpose: TokenPurpose, token: string): Promise<string | null> {
    return this.redis.get(`token:${purpose}:${token}`);
  }

  async consume(purpose: TokenPurpose, token: string): Promise<string | null> {
    const key = `token:${purpose}:${token}`;
    const userId = await this.redis.get(key);
    if (userId) await this.redis.del(key);
    return userId;
  }
}
