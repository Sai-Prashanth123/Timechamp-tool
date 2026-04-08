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

  it('peek returns userId without deleting key', async () => {
    redis.get.mockResolvedValue('user-456');
    const result = await service.peek('invite', 'some-token');
    expect(result).toBe('user-456');
    expect(redis.del).not.toHaveBeenCalled();
  });
});
