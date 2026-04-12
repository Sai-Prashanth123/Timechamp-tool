import {
  Injectable, CanActivate, ExecutionContext, UnauthorizedException,
  Inject, forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { AgentService } from './agent.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

/**
 * AgentAuthGuard
 *
 * Authenticates desktop-agent requests. At 100K concurrent agents this guard
 * runs ~50,000 times per second (heartbeats + command polls + activity syncs
 * combined), so every DB query here matters. Round 5 / R5.2 added a 5-minute
 * Redis cache keyed on the raw device token — a cache hit costs ~0.1ms and
 * skips two DB queries (findDeviceByToken + userRepo.findOne). Cache miss
 * falls back to the original lookup and populates the cache for next time.
 *
 * As of the personal-token + device-centric refactor, the cache payload
 * also carries the device identity (`id`, `displayName`, `hostname`) so
 * downstream code can key activity / screenshots by device without extra
 * DB round-trips. Cache key prefix is versioned (`agentauth:v2:`) so any
 * stale entries written before this change are ignored on deploy.
 *
 * Invalidation: if a device token is revoked at runtime (rare), the revoker
 * must also call `redis.del('agentauth:v2:' + token)` so the guard doesn't
 * keep accepting it for up to 5 minutes.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  // 5 minutes — the blast radius of a revoked token between the revocation
  // and the next forced cache miss. Shorter values mean more DB load, longer
  // values mean revoked tokens linger. 300s is a reasonable middle.
  private static readonly CACHE_TTL_SECONDS = 300;
  private static readonly CACHE_PREFIX = 'agentauth:v2:';

  constructor(
    @Inject(forwardRef(() => AgentService))
    private agentService: AgentService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader: string | undefined = request.headers['authorization'];
    const xDeviceToken: string | undefined = request.headers['x-device-token'];
    const raw = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : xDeviceToken;

    if (!raw) throw new UnauthorizedException('No device token provided');

    // ── Cache hit path ───────────────────────────────────────────────────
    // A compact projection is all downstream code needs from the guard:
    // user fields + device identity. Cached as JSON so we don't hold a
    // TypeORM entity reference across requests.
    const cacheKey = `${AgentAuthGuard.CACHE_PREFIX}${raw}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          user: User;
          device: { id: string; displayName: string | null; hostname: string | null };
        };
        request.agentUser = parsed.user;
        request.device = parsed.device;
        return true;
      } catch {
        // Corrupted entry — fall through to the DB path and repopulate.
      }
    }

    // ── Cache miss path ──────────────────────────────────────────────────
    const device = await this.agentService.findDeviceByToken(raw);
    if (!device) throw new UnauthorizedException('Invalid or expired device token');

    const user = await this.userRepo.findOne({ where: { id: device.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');

    // Store only the fields downstream code reads. Keeps the cache payload
    // small (~300 bytes per entry → 100K entries = ~30MB RAM).
    const compactUser = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      isActive: user.isActive,
    };
    const compactDevice = {
      id: device.id,
      displayName: device.displayName,
      hostname: device.hostname,
    };
    await this.redis.set(
      cacheKey,
      JSON.stringify({ user: compactUser, device: compactDevice }),
      AgentAuthGuard.CACHE_TTL_SECONDS,
    );

    request.agentUser = user;
    request.device = compactDevice;
    return true;
  }
}
