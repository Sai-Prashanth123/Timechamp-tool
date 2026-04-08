// apps/api/src/modules/alerts/alerts.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

// ── DTOs ──────────────────────────────────────────────────────────────

export class CreateAlertRuleDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  type: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  threshold?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;
}

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  threshold?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyInApp?: boolean;
}

// ── Controller ────────────────────────────────────────────────────────

@ApiTags('Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  // ── Rules ──────────────────────────────────────────────────────────

  @Get('rules')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List alert rules for the org (admin/manager only)' })
  getRules(@CurrentUser() user: User) {
    return this.service.getRules(user.organizationId);
  }

  @Post('rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an alert rule (admin only)' })
  createRule(@CurrentUser() user: User, @Body() dto: CreateAlertRuleDto) {
    return this.service.createRule(user.organizationId, {
      name: dto.name,
      type: dto.type,
      threshold: dto.threshold ?? 30,
      notifyEmail: dto.notifyEmail,
      notifyInApp: dto.notifyInApp,
    });
  }

  @Patch('rules/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an alert rule (admin only)' })
  updateRule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    return this.service.updateRule(id, {
      name: dto.name,
      threshold: dto.threshold,
      enabled: dto.enabled,
      notifyEmail: dto.notifyEmail,
      notifyInApp: dto.notifyInApp,
    });
  }

  @Delete('rules/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alert rule (admin only)' })
  async deleteRule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteRule(id);
  }

  // ── Events ─────────────────────────────────────────────────────────
  // NOTE: 'events/unread-count' MUST come before 'events/:id' routes
  // to avoid NestJS treating 'unread-count' as an :id param.

  @Get('events/unread-count')
  @ApiOperation({ summary: 'Count of unseen alert events for the current user' })
  async getUnreadCount(@CurrentUser() user: User): Promise<{ count: number }> {
    const count = await this.service.getUnreadCount(user.organizationId, user.id);
    return { count };
  }

  @Get('events')
  @ApiOperation({ summary: 'List alert events' })
  @ApiQuery({ name: 'userId', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  listEvents(
    @CurrentUser() user: User,
    @Query('userId') userId?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    const isManager = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    const effectiveUserId = isManager ? userId : user.id;
    return this.service.getEvents(user.organizationId, effectiveUserId, limit);
  }

  @Patch('events/:id/seen')
  @ApiOperation({ summary: 'Mark an alert event as seen' })
  async markSeen(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.markSeen(id);
  }

  @Post('events/:id/acknowledge')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Acknowledge an alert event (manager/admin)' })
  async acknowledgeEvent(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.markSeen(id);
  }
}
