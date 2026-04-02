import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';
import {
  IsUrl,
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  IsIn,
  MaxLength,
} from 'class-validator';
import { IntegrationsService, WEBHOOK_EVENTS } from './integrations.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

// ── DTOs ─────────────────────────────────────────────────────────────

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string;

  @IsOptional()
  @IsArray()
  @IsIn([...WEBHOOK_EVENTS], { each: true })
  events?: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  secret?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn([...WEBHOOK_EVENTS], { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SaveSlackDto {
  @IsUrl({ require_tld: false })
  webhookUrl: string;
}

// ── Controller ────────────────────────────────────────────────────────

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly service: IntegrationsService) {}

  // ── Webhook endpoints ──────────────────────────────────────────────

  @Get('webhooks')
  @ApiOperation({ summary: 'List registered webhook endpoints for the org' })
  listWebhooks(@CurrentUser() user: User) {
    return this.service.listEndpoints(user.organizationId);
  }

  @Post('webhooks')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Register a new webhook endpoint (admin only)' })
  @ApiBody({ type: CreateWebhookDto })
  createWebhook(@CurrentUser() user: User, @Body() dto: CreateWebhookDto) {
    return this.service.createEndpoint(user.organizationId, dto);
  }

  @Patch('webhooks/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a webhook endpoint (admin only)' })
  @ApiBody({ type: UpdateWebhookDto })
  updateWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    return this.service.updateEndpoint(user.organizationId, id, dto);
  }

  @Delete('webhooks/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook endpoint (admin only)' })
  async deleteWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteEndpoint(user.organizationId, id);
  }

  @Post('webhooks/:id/test')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a test ping to the webhook endpoint (admin only)' })
  async testWebhook(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.testEndpoint(user.organizationId, id);
  }

  @Get('webhooks/:id/deliveries')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get recent delivery log for a webhook endpoint (admin only)' })
  getDeliveries(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getDeliveries(user.organizationId, id);
  }

  // ── Slack ──────────────────────────────────────────────────────────

  @Get('slack')
  @ApiOperation({ summary: 'Get Slack integration config for the org (URL masked)' })
  getSlack(@CurrentUser() user: User) {
    return this.service.getSlackConfig(user.organizationId);
  }

  @Post('slack')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Save / update Slack incoming webhook URL (admin only)' })
  @ApiBody({ type: SaveSlackDto })
  saveSlack(@CurrentUser() user: User, @Body() dto: SaveSlackDto) {
    return this.service.saveSlackConfig(user.organizationId, dto.webhookUrl);
  }

  @Delete('slack')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove Slack integration (admin only)' })
  async deleteSlack(@CurrentUser() user: User): Promise<void> {
    await this.service.deleteSlackConfig(user.organizationId);
  }

  @Post('slack/test')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Send a test message to Slack (admin only)' })
  async testSlack(@CurrentUser() user: User): Promise<void> {
    await this.service.testSlack(user.organizationId);
  }
}
