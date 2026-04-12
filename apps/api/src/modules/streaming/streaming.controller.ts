import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { LiveWatchCache } from './live-watch-cache.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';
import { AgentDevice } from '../../database/entities/agent-device.entity';
import { StreamMode } from '../../database/entities/stream-session.entity';

// TTL for the live-view watch flag. Must be longer than the browser's refresh
// cadence (20s) to avoid a window where the agent thinks no one is watching.
// 60s gives a healthy safety margin.
const WATCH_FLAG_TTL_SECONDS = 60;

class UpdateModeDto {
  mode: StreamMode;
}

class UpdateStreamingConfigDto {
  streamingEnabled?: boolean;
  cameraEnabled?: boolean;
  audioEnabled?: boolean;
  maxStreamFps?: number;
  dailyBandwidthCapMb?: number;
}

@ApiTags('Streaming')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('streaming')
export class StreamingController {
  constructor(
    private readonly streamingService: StreamingService,
    private readonly streamingGateway: StreamingGateway,
    private readonly liveWatchCache: LiveWatchCache,
    @InjectRepository(AgentDevice)
    private readonly deviceRepo: Repository<AgentDevice>,
  ) {}

  @Get('sessions')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all active streaming sessions for the org' })
  getActiveSessions(@CurrentUser() user: User) {
    return this.streamingService.getActiveSessions(user.organizationId);
  }

  @Get('sessions/stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get bandwidth stats for the org within a date range' })
  @ApiQuery({ name: 'from', required: true, description: 'ISO date string (start)' })
  @ApiQuery({ name: 'to', required: true, description: 'ISO date string (end)' })
  getSessionStats(
    @CurrentUser() user: User,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('Query params "from" and "to" are required');
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('"from" and "to" must be valid ISO date strings');
    }
    return this.streamingService.getSessionStats(user.organizationId, fromDate, toDate);
  }

  @Post('sessions/:userId/mode')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the streaming mode for an active session' })
  @ApiParam({ name: 'userId', description: 'Target user ID' })
  @ApiBody({ schema: { properties: { mode: { type: 'string', enum: ['idle', 'grid', 'full'] } } } })
  async updateSessionMode(
    @Param('userId') userId: string,
    @Body() body: UpdateModeDto,
  ) {
    const allowed: StreamMode[] = ['idle', 'grid', 'full'];
    if (!allowed.includes(body.mode)) {
      throw new BadRequestException(`mode must be one of: ${allowed.join(', ')}`);
    }
    await this.streamingService.updateSessionMode(userId, body.mode);
    return { updated: true, userId, mode: body.mode };
  }

  @Get('config')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get the streaming configuration for the org' })
  getOrgStreamingConfig(@CurrentUser() user: User) {
    return this.streamingService.getOrgStreamingConfig(user.organizationId);
  }

  @Put('config')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update the streaming configuration for the org (Admin only)' })
  @ApiBody({ type: Object, description: 'Streaming config fields to update' })
  updateOrgStreamingConfig(
    @CurrentUser() user: User,
    @Body() body: UpdateStreamingConfigDto,
  ) {
    return this.streamingService.updateOrgStreamingConfig(user.organizationId, body);
  }

  // ── Device-scoped live watch ─────────────────────────────────────────
  //
  // The /live page requests watching a SPECIFIC device (AMMA vs DEV-MACHINE)
  // so the LiveWatchCache flags only that one agent. The agent polls
  // /agent/sync/commands and enters burst mode only when its own flag is set.

  @Post('request/device/:deviceId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request on-demand live view for a specific agent device',
  })
  async requestStreamByDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string; deviceId: string }> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, organizationId: user.organizationId },
    });
    if (!device) throw new NotFoundException('Device not found');

    this.liveWatchCache.markWatched(device.userId, device.id, WATCH_FLAG_TTL_SECONDS);
    this.streamingGateway.sendControlToAgent(device.userId, {
      action: 'start_stream',
      requestedBy: user.id,
    });
    return { accepted: true, userId: device.userId, deviceId: device.id };
  }

  @Post('request/device/:deviceId/stop')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Stop on-demand live view for a specific agent device' })
  async stopStreamByDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string; deviceId: string }> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, organizationId: user.organizationId },
    });
    if (!device) throw new NotFoundException('Device not found');

    this.liveWatchCache.clearWatched(device.userId, device.id);
    this.streamingGateway.sendControlToAgent(device.userId, {
      action: 'stop_stream',
      requestedBy: user.id,
    });
    return { accepted: true, userId: device.userId, deviceId: device.id };
  }

  // ── Legacy user-scoped live watch ────────────────────────────────────
  //
  // Kept for /monitoring/[userId] which is user-centric by design. Internally
  // it now picks the user's most recently seen active device and flags just
  // that one — so a user with two devices only bursts the most recent one.
  // If a caller needs to target a specific device, use the /request/device/
  // routes above.

  @Post('request/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Request on-demand live view by userId (legacy — picks most recent device)',
  })
  async requestStream(
    @Param('userId') userId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string; deviceId?: string }> {
    const device = await this.deviceRepo.findOne({
      where: { userId, organizationId: user.organizationId, isActive: true },
      order: { lastSeenAt: 'DESC' },
    });
    if (!device) {
      // No active device — still accept the request so the frontend's
      // flow doesn't break, but nothing to flag in the cache.
      return { accepted: true, userId };
    }
    this.liveWatchCache.markWatched(userId, device.id, WATCH_FLAG_TTL_SECONDS);
    this.streamingGateway.sendControlToAgent(userId, {
      action: 'start_stream',
      requestedBy: user.id,
    });
    return { accepted: true, userId, deviceId: device.id };
  }

  @Post('request/:userId/stop')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Stop on-demand live view by userId (legacy)' })
  async stopStream(
    @Param('userId') userId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string }> {
    // Clear any device for this user that might be in burst mode.
    const devices = await this.deviceRepo.find({
      where: { userId, organizationId: user.organizationId, isActive: true },
      select: ['id'],
    });
    for (const d of devices) {
      this.liveWatchCache.clearWatched(userId, d.id);
    }
    this.streamingGateway.sendControlToAgent(userId, {
      action: 'stop_stream',
      requestedBy: user.id,
    });
    return { accepted: true, userId };
  }
}
