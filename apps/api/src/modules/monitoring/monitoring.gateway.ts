import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

// ── Socket payload shapes ─────────────────────────────────────────────
//
// `deviceId` was added when the dashboard flipped from employee-centric
// ("1 user = 1 online slot") to device-centric ("1 user can own N agents,
// each shown separately"). It's optional for backwards compat: any code
// path that doesn't yet know the device (legacy tests, future bulk
// emitters) can still fire without it, and the frontend falls back to
// broadcasting to every device owned by that userId.

export interface EmployeeStatusPayload {
  userId: string;
  deviceId?: string;
  status: 'online' | 'idle' | 'offline';
  activeApp?: string | null;
  lastSeen: Date;
}

export interface EmployeeScreenshotPayload {
  userId: string;
  deviceId?: string;
  screenshotId: string;
  capturedAt: Date;
  /**
   * Presigned download URL for the screenshot. Included in the emit so the
   * browser can render the frame immediately without a follow-up REST call.
   * When the upstream save path can't produce a URL (e.g. CDN disabled, S3
   * misconfigured) this is an empty string and the browser falls back to its
   * HTTP poll.
   */
  url: string;
}

export interface EmployeeActivityPayload {
  userId: string;
  deviceId?: string;
  appName: string;
  windowTitle?: string | null;
  timestamp: Date;
}

export interface AlertEventPayload {
  eventId: string;
  ruleId: string;
  ruleName: string;
  type: string;
  userId: string;
  message: string;
  triggeredAt: Date;
}

@WebSocketGateway({ namespace: '/monitoring', cors: true })
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(MonitoringGateway.name);
  private connections = new Map<string, { userId: string; orgId: string }>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) { client.disconnect(); return; }
    try {
      const payload = this.jwtService.verify(token) as { sub: string; orgId: string };
      this.connections.set(client.id, { userId: payload.sub, orgId: payload.orgId });
      client.join(`org:${payload.orgId}`);
      this.logger.debug(`Manager ${payload.sub} connected to monitoring`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connections.delete(client.id);
  }

  emitEmployeeStatus(orgId: string, payload: EmployeeStatusPayload): void {
    this.server?.to(`org:${orgId}`).emit('employee:status', payload);
  }

  emitScreenshotTaken(orgId: string, payload: EmployeeScreenshotPayload): void {
    this.server?.to(`org:${orgId}`).emit('employee:screenshot', payload);
  }

  emitActivityUpdate(orgId: string, payload: EmployeeActivityPayload): void {
    this.server?.to(`org:${orgId}`).emit('employee:activity', payload);
  }

  emitAlertNew(orgId: string, payload: AlertEventPayload): void {
    this.server?.to(`org:${orgId}`).emit('alert:new', payload);
  }
}
