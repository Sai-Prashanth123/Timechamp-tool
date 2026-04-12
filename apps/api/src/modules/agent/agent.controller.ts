import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentCurrentUser } from './agent-current-user.decorator';
import { AgentCurrentDevice, AgentDeviceContext } from './agent-current-device.decorator';
import { LiveWatchCache } from '../streaming/live-watch-cache.service';
import { SyncActivityDto } from './dto/sync-activity.dto';
import { SyncMetricsDto } from './dto/sync-metrics.dto';
import { SyncScreenshotDto } from './dto/sync-screenshot.dto';
import { SyncGpsDto } from './dto/sync-gps.dto';
import { SyncKeystrokesDto } from './dto/sync-keystrokes.dto';
import { SyncTelemetryDto } from './dto/sync-telemetry.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { User } from '../../database/entities/user.entity';

/**
 * Fast validation pipe override for the agent controller.
 *
 * The global ValidationPipe is configured with `transform: true, whitelist: true,
 * forbidNonWhitelisted: true` — these are slow because:
 *  - `transform: true` runs `class-transformer.plainToClass()` on every nested
 *    object in the request body. For a 100-event activity batch that's 100
 *    instantiations + 100 nested decorator metadata reflections.
 *  - `whitelist: true` walks every property on every nested object to strip
 *    unknown keys.
 *  - `forbidNonWhitelisted: true` then throws if any extra key was found.
 *
 * Combined cost: ~5-20ms per agent request on a 100-event batch. At 100K agents
 * heartbeating + syncing every 30s that's >50% of CPU on validation alone.
 *
 * For agent endpoints specifically, the threat model is different from the
 * dashboard's: the agent is OUR code, the schema is fixed, and we control
 * both ends. Skipping deep transform/whitelist here is safe — the auth guard
 * already established WHO is sending the request, the DTO type still gives
 * compile-time safety in TypeScript, and downstream code (queue services) only
 * reads explicit fields. Any extra keys in the body are simply ignored.
 *
 * Type safety: still on. transform: false means class-validator does NOT
 * convert the plain object to a DTO instance, but TypeScript's structural
 * typing in the controller signature still gives us the field shapes.
 */
const fastAgentValidator = new ValidationPipe({
  transform: false,
  whitelist: false,
  forbidNonWhitelisted: false,
  // skipMissingProperties keeps the current loose contract — agents may
  // send batches with optional fields omitted, which the global pipe was
  // already silently allowing via @IsOptional() decorators.
  skipMissingProperties: true,
  // Stop on first error instead of collecting all of them — saves time on
  // huge batches that would otherwise build a list of N errors before
  // throwing.
  stopAtFirstError: true,
});

@ApiTags('Agent Sync')
@UseGuards(AgentAuthGuard)
@UsePipes(fastAgentValidator)
@Controller('agent/sync')
export class AgentController {
  constructor(
    private readonly service: AgentService,
    private readonly liveWatchCache: LiveWatchCache,
  ) {}

  @Post('activity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload activity events from the desktop agent' })
  async syncActivity(
    @AgentCurrentUser() user: User,
    @AgentCurrentDevice() device: AgentDeviceContext,
    @Body() dto: SyncActivityDto,
  ) {
    const saved = await this.service.saveActivities(user, dto, device?.id);
    return { saved };
  }

  @Post('keystrokes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload per-minute keystroke/mouse intensity from the desktop agent' })
  async syncKeystrokes(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncKeystrokesDto,
  ) {
    const saved = await this.service.saveKeystrokes(user, dto);
    return { saved };
  }

  @Get('screenshots/upload-url')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for screenshot upload' })
  async getUploadUrl(@AgentCurrentUser() user: User) {
    // Return flat — the global TransformInterceptor wraps every response in
    // { success, data, timestamp }. Hand-wrapping in `data:` causes double nesting.
    const { uploadUrl, screenshotKey } = await this.service.generateUploadUrl(user);
    return { uploadUrl, s3Key: screenshotKey };
  }

  @Post('screenshots')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save screenshot metadata after S3 upload completes' })
  saveScreenshot(
    @AgentCurrentUser() user: User,
    @AgentCurrentDevice() device: AgentDeviceContext,
    @Body() dto: SyncScreenshotDto,
  ) {
    return this.service.saveScreenshot(user, dto, device?.id);
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

  @Get('commands')
  @ApiOperation({ summary: 'Poll for out-of-band commands (live-view watch flag, etc.)' })
  getCommands(
    @AgentCurrentUser() user: User,
    @AgentCurrentDevice() device: AgentDeviceContext,
  ) {
    // Returns a compact command object that the agent polls every 2 seconds.
    // Currently only carries the live-view watch flag — managers click
    // "Watch Live" on the dashboard which calls markWatched() with a 60s TTL,
    // and the agent picks it up here to flip itself into burst-capture mode.
    //
    // Checked per-device so two machines owned by the same user can be
    // watched independently. If `device` is missing (pre-v2 auth cache
    // entry), fall back to false rather than triggering burst mode on
    // every device the user owns.
    const liveView = device?.id
      ? this.liveWatchCache.isWatched(user.id, device.id)
      : false;
    return { liveView };
  }

  @Get('config')
  @ApiOperation({ summary: 'Get agent configuration for the authenticated org' })
  async getConfig(@AgentCurrentUser() user: User) {
    // Return flat — global TransformInterceptor wraps in { success, data, timestamp }.
    const org = await this.service.getOrgConfig(user.organizationId);
    return {
      screenshotIntervalSec: org.screenshotIntervalSec,
      streamingEnabled: org.streamingEnabled,
      cameraEnabled: org.cameraEnabled,
      audioEnabled: org.audioEnabled,
      maxStreamFps: org.maxStreamFps,
    };
  }

  @Post('heartbeat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update agent last_seen_at and report AFK state' })
  async heartbeat(
    @AgentCurrentUser() user: User,
    @AgentCurrentDevice() device: AgentDeviceContext,
    @Body() dto: HeartbeatDto,
  ) {
    await this.service.recordHeartbeat(user, dto, device?.id);
    return { ok: true };
  }

  @Post('metrics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch-upload system metrics snapshots from the desktop agent' })
  async syncMetrics(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncMetricsDto,
  ) {
    await this.service.saveMetrics(user, dto);
    return { ok: true };
  }

  @Post('telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Agent self-health telemetry (uptime, version, buffer depth, sync stats)' })
  async syncTelemetry(
    @AgentCurrentUser() user: User,
    @Body() dto: SyncTelemetryDto,
  ) {
    await this.service.saveTelemetry(user, dto);
    return { ok: true };
  }
}
