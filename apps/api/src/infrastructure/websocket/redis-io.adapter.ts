import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { INestApplication } from '@nestjs/common';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const pubClient = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const corsOrigin = process.env.WS_CORS_ORIGIN || '*';
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
      transports: ['websocket'],
      maxHttpBufferSize: 2e6,
    });
    server.adapter(this.adapterConstructor);
    return server;
  }
}
