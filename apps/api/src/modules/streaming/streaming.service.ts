import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StreamSession, StreamMode } from '../../database/entities/stream-session.entity';
import { Organization } from '../../database/entities/organization.entity';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class StreamingService {
  constructor(
    @InjectRepository(StreamSession) private sessionRepo: Repository<StreamSession>,
    @InjectRepository(Organization) private orgRepo: Repository<Organization>,
    private redis: RedisService,
  ) {}

  async getActiveSessions(orgId: string): Promise<StreamSession[]> {
    return this.sessionRepo.find({ where: { organizationId: orgId, isActive: true } });
  }

  async createSession(userId: string, orgId: string, socketId: string): Promise<StreamSession> {
    const session = this.sessionRepo.create({ userId, organizationId: orgId, socketId, isActive: true, mode: 'idle' });
    return this.sessionRepo.save(session);
  }

  async closeSession(socketId: string, reason: string): Promise<void> {
    await this.sessionRepo.update({ socketId, isActive: true }, { isActive: false, endedAt: new Date(), disconnectReason: reason });
  }

  async getSessionByUserId(userId: string): Promise<StreamSession | null> {
    return this.sessionRepo.findOne({
      where: { userId, isActive: true },
      order: { startedAt: 'DESC' },
    });
  }

  async updateSessionMode(userId: string, mode: StreamMode): Promise<void> {
    await this.sessionRepo.update({ userId, isActive: true }, { mode });
  }

  async trackBandwidth(userId: string, bytes: number): Promise<boolean> {
    const today = new Date().toISOString().slice(0, 10);
    const key = `bw:${userId}:${today}`;
    const current = await this.redis.get(key);
    const currentBytes = current ? parseInt(current, 10) : 0;
    const newTotal = currentBytes + bytes;
    await this.redis.set(key, String(newTotal), 90000); // 25-hour TTL
    // Get org cap (use default 500MB if not found)
    const capMb = 500;
    return newTotal < capMb * 1024 * 1024;
  }

  async getSessionStats(orgId: string, from: Date, to: Date) {
    return this.sessionRepo
      .createQueryBuilder('s')
      .select('s.userId', 'userId')
      .addSelect('SUM(s.bytesRx)', 'bytesRx')
      .addSelect('SUM(s.bytesTx)', 'bytesTx')
      .addSelect('COUNT(*)', 'sessionCount')
      .where('s.organizationId = :orgId', { orgId })
      .andWhere('s.startedAt BETWEEN :from AND :to', { from, to })
      .groupBy('s.userId')
      .getRawMany();
  }

  async getOrgStreamingConfig(orgId: string) {
    const org = await this.orgRepo.findOne({
      where: { id: orgId },
      select: ['id', 'streamingEnabled', 'cameraEnabled', 'audioEnabled', 'maxStreamFps', 'dailyBandwidthCapMb'],
    });
    return {
      streamingEnabled: org?.streamingEnabled ?? false,
      cameraEnabled: org?.cameraEnabled ?? false,
      audioEnabled: org?.audioEnabled ?? false,
      maxStreamFps: org?.maxStreamFps ?? 1,
      dailyBandwidthCapMb: org?.dailyBandwidthCapMb ?? 500,
    };
  }

  async updateOrgStreamingConfig(
    orgId: string,
    updates: Partial<{
      streamingEnabled: boolean;
      cameraEnabled: boolean;
      audioEnabled: boolean;
      maxStreamFps: number;
      dailyBandwidthCapMb: number;
    }>,
  ) {
    await this.orgRepo.update({ id: orgId }, updates);
    return this.getOrgStreamingConfig(orgId);
  }
}
