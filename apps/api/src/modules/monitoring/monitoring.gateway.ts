import {
  WebSocketGateway, WebSocketServer,
  OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

export interface EmployeeStatusPayload {
  userId: string;
  status: 'online' | 'idle' | 'offline';
  activeApp?: string | null;
  lastSeen: Date;
}

export interface EmployeeScreenshotPayload {
  userId: string;
  screenshotId: string;
  capturedAt: Date;
}

export interface EmployeeActivityPayload {
  userId: string;
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
