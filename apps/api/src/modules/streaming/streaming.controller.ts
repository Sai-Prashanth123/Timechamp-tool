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
import { StreamingService } from './streaming.service';
import { StreamingGateway } from './streaming.gateway';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';
import { StreamMode } from '../../database/entities/stream-session.entity';

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

  @Post('request/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request on-demand stream from agent' })
  async requestStream(
    @Param('userId') userId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string }> {
    const sent = this.streamingGateway.sendControlToAgent(userId, {
      action: 'start_stream',
      requestedBy: user.id,
    });
    if (!sent) {
      const session = await this.streamingService.getSessionByUserId(userId);
      if (!session) {
        throw new NotFoundException(`Agent for user ${userId} is not currently connected`);
      }
      this.streamingGateway.sendControlToAgent(userId, { action: 'start_stream', requestedBy: user.id });
    }
    return { accepted: true, userId };
  }

  @Post('request/:userId/stop')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Stop on-demand stream for agent' })
  async stopStream(
    @Param('userId') userId: string,
    @CurrentUser() user: User,
  ): Promise<{ accepted: boolean; userId: string }> {
    const sent = this.streamingGateway.sendControlToAgent(userId, {
      action: 'stop_stream',
      requestedBy: user.id,
    });
    if (!sent) {
      throw new NotFoundException(`Agent for user ${userId} is not currently connected`);
    }
    return { accepted: true, userId };
  }
}
