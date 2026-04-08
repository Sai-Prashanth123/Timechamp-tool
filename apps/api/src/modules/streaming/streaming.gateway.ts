import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { StreamingService } from './streaming.service';
import { parseFrame, buildControlFrame } from './protocol';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../infrastructure/redis/redis.service';

interface ConnectionMeta {
  userId: string;
  orgId: string;
  isAgent: boolean;
  timeout?: NodeJS.Timeout;
}

@WebSocketGateway({ namespace: '/stream', cors: true })
export class StreamingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(StreamingGateway.name);

  // Maps socketId → { userId, orgId, isAgent, timeout }
  private connections = new Map<string, ConnectionMeta>();
  private agentSockets = new Map<string, string>(); // userId → socketId

  constructor(
    private streamingService: StreamingService,
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwtService: JwtService,
    private config: ConfigService,
    private redis: RedisService,
  ) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    // Try agent token first
    const agentUser = await this.userRepo.findOne({ where: { agentToken: token } as any });
    if (agentUser) {
      const conn: ConnectionMeta = { userId: agentUser.id, orgId: agentUser.organizationId, isAgent: true };
      this.connections.set(client.id, conn);
      this.agentSockets.set(agentUser.id, client.id);
      client.join(`agent:${agentUser.id}`);
      client.join(`org:${agentUser.organizationId}`);
      await this.streamingService.createSession(agentUser.id, agentUser.organizationId, client.id);
      this.server.to(`org:${agentUser.organizationId}`).emit('stream:online', { userId: agentUser.id });

      // Session timeout
      const maxHours = this.config.get<number>('SESSION_MAX_HOURS') || 8;
      const timeout = setTimeout(() => {
        client.emit('stream:control', buildControlFrame({ action: 'session_timeout' }));
        client.disconnect();
      }, maxHours * 3600 * 1000);

      this.connections.set(client.id, { ...conn, timeout });
      return;
    }

    // Try JWT (manager)
    try {
      const payload = this.jwtService.verify(token) as { sub: string; orgId: string };
      const conn: ConnectionMeta = { userId: payload.sub, orgId: payload.orgId, isAgent: false };
      this.connections.set(client.id, conn);
      client.join(`manager:${payload.orgId}`);
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const conn = this.connections.get(client.id);
    if (!conn) return;
    if (conn.timeout) clearTimeout(conn.timeout);
    this.connections.delete(client.id);
    if (conn.isAgent) {
      this.agentSockets.delete(conn.userId);
      await this.streamingService.closeSession(client.id, 'disconnected');
      this.server.to(`org:${conn.orgId}`).emit('stream:offline', { userId: conn.userId });
    }
  }

  @SubscribeMessage('frame')
  async handleFrame(client: Socket, data: Buffer) {
    const conn = this.connections.get(client.id);
    if (!conn?.isAgent) return;

    // Track daily bandwidth
    const withinCap = await this.streamingService.trackBandwidth(conn.userId, data.length);
    if (!withinCap) {
      client.emit('stream:control', buildControlFrame({ action: 'bandwidth_cap_exceeded' }));
      return;
    }

    // Track monthly egress in Redis (fire-and-forget)
    const monthKey = `egress:monthly:${new Date().toISOString().slice(0, 7)}`;
    this.redis.get(monthKey).then((val) => {
      const current = val ? parseInt(val, 10) : 0;
      return this.redis.set(monthKey, String(current + data.length));
    }).catch(() => { /* ignore egress tracking errors */ });

    // Parse frame type and relay to watchers
    try {
      const { type } = parseFrame(data);
      const room = `watchers:${conn.userId}`;
      this.server.to(room).emit('stream:frame', data, conn.userId, type);
    } catch {
      // malformed frame, ignore
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { userId: string }) {
    const conn = this.connections.get(client.id);
    if (!conn || conn.isAgent) return;
    client.join(`watchers:${payload.userId}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, payload: { userId: string }) {
    client.leave(`watchers:${payload.userId}`);
  }

  sendControlToAgent(userId: string, payload: Record<string, unknown>): boolean {
    const socketId = this.agentSockets.get(userId);
    if (!socketId) return false;
    this.server?.to(socketId).emit('stream:control', payload);
    return true;
  }
}
