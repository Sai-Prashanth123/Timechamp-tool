import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface MemEntry {
  value: string;
  expiresAt: number | null;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private mem = new Map<string, MemEntry>();
  private readonly storeFile = path.join(os.tmpdir(), 'timechamp-dev-store.json');

  constructor(private config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL');
    if (!redisUrl) {
      this.logger.warn(`REDIS_URL not set — using file-backed store: ${this.storeFile}`);
      this.loadFromDisk();
      return;
    }

    this.client = new Redis(redisUrl, {
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err: Error) =>
      this.logger.error('Redis connection error', err.message),
    );
    this.client.on('connect', () => this.logger.log('Redis connected'));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      if (ttlSeconds) {
        await this.client.setex(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
      return;
    }
    const entry: MemEntry = {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    };
    this.mem.set(key, entry);
    this.saveToDisk();
  }

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const entry = this.mem.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.mem.delete(key);
      this.saveToDisk();
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.mem.delete(key);
    this.saveToDisk();
  }

  async exists(key: string): Promise<boolean> {
    if (this.client) return (await this.client.exists(key)) === 1;
    return (await this.get(key)) !== null;
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storeFile)) return;
      const raw = fs.readFileSync(this.storeFile, 'utf8');
      const entries: Record<string, MemEntry> = JSON.parse(raw);
      const now = Date.now();
      for (const [k, v] of Object.entries(entries)) {
        if (v.expiresAt === null || v.expiresAt > now) {
          this.mem.set(k, v);
        }
      }
      this.logger.log(`Loaded ${this.mem.size} entries from ${this.storeFile}`);
    } catch {
      // fresh start
    }
  }

  private saveToDisk(): void {
    try {
      const obj: Record<string, MemEntry> = {};
      for (const [k, v] of this.mem.entries()) obj[k] = v;
      fs.writeFileSync(this.storeFile, JSON.stringify(obj), 'utf8');
    } catch (err) {
      this.logger.warn(`Could not save store to disk: ${err}`);
    }
  }
}
