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
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiBody,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  MaxLength,
  Min,
} from 'class-validator';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

// ── Valid metric values ────────────────────────────────────────────────

export const ALERT_METRICS = [
  'idle_time',
  'no_activity',
  'late_clock_in',
  'missed_clock_in',
] as const;

// ── DTOs ──────────────────────────────────────────────────────────────

export class CreateAlertRuleDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsIn([...ALERT_METRICS])
  metric: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn([...ALERT_METRICS])
  metric?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
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
  @ApiOperation({ summary: 'List alert rules for the org (admin/manager)' })
  listRules(@CurrentUser() user: User) {
    return this.service.listRules(user.organizationId);
  }

  @Post('rules')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an alert rule (admin only)' })
  @ApiBody({ type: CreateAlertRuleDto })
  createRule(@CurrentUser() user: User, @Body() dto: CreateAlertRuleDto) {
    return this.service.createRule(user.organizationId, dto);
  }

  @Patch('rules/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an alert rule (admin only)' })
  @ApiBody({ type: UpdateAlertRuleDto })
  updateRule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    return this.service.updateRule(id, user.organizationId, dto);
  }

  @Delete('rules/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alert rule (admin only)' })
  async deleteRule(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.deleteRule(id, user.organizationId);
  }

  // ── Events ─────────────────────────────────────────────────────────

  @Get('events')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'List recent alert events (admin/manager)' })
  listEvents(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.service.listEvents(user.organizationId, parsedLimit);
  }

  @Post('events/:id/acknowledge')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Acknowledge an alert event (admin/manager)' })
  acknowledgeEvent(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.acknowledgeEvent(id, user.organizationId, user.id);
  }
}
