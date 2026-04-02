import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentCurrentUser } from './agent-current-user.decorator';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';
import { SyncGpsDto } from './dto/sync-gps.dto';
import { User } from '../../database/entities/user.entity';

@ApiTags('Agent Sync')
@UseGuards(AgentAuthGuard)
@Controller('agent/sync')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Post('activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload activity events from the desktop agent' })
  async syncActivity(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncActivityDto,
  ) {
    const saved = await this.service.saveActivities(user, dto);
    return { saved };
  }

  @Post('keystrokes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keystroke counts (rolled up into activity events, no-op here)' })
  syncKeystrokes() {
    // Keystroke counts are already included in SyncActivityDto.keystrokeCount.
    // This endpoint exists so the Go agent does not receive 404 errors.
    return { accepted: true };
  }

  @Get('screenshots/upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for screenshot upload' })
  getUploadUrl(@AgentCurrentUser() user: User) {
    return this.service.generateUploadUrl(user);
  }

  @Post('screenshots')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save screenshot metadata after S3 upload completes' })
  saveScreenshot(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncScreenshotDto,
  ) {
    return this.service.saveScreenshot(user, dto);
  }

  @Post('gps')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload GPS location points from the agent/mobile device' })
  async syncGps(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncGpsDto,
  ) {
    const saved = await this.service.saveGpsLocations(user, dto);
    return { saved };
  }
}
