import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Res,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { AuditLogService } from './audit-log.service';
import { GetAuditLogDto } from './dto/get-audit-log.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ExportTimesheetsDto } from './dto/export-timesheets.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ── Stats ─────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Get aggregated organization statistics' })
  async getStats(@CurrentUser() user: User) {
    const stats = await this.adminService.getOrgStats(user.organizationId);
    return { data: stats };
  }

  // ── Audit Log ─────────────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'Get paginated audit log for the organization' })
  async getAuditLog(
    @CurrentUser() user: User,
    @Query() dto: GetAuditLogDto,
  ) {
    const result = await this.auditLogService.getLogs(user.organizationId, {
      actorId: dto.actorId,
      action: dto.action,
      from: dto.from ? new Date(dto.from) : undefined,
      to: dto.to ? new Date(dto.to) : undefined,
      limit: dto.limit,
      offset: dto.offset,
    });
    return { data: result.logs, total: result.total };
  }

  // ── Exports ───────────────────────────────────────────────────────────

  @Get('export/users')
  @ApiOperation({ summary: 'Download all users as CSV' })
  async exportUsers(@CurrentUser() user: User, @Res() res: Response) {
    const csv = await this.adminService.exportUsersCSV(user.organizationId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  @Get('export/timesheets')
  @ApiOperation({ summary: 'Download timesheets in a date range as CSV' })
  async exportTimesheets(
    @CurrentUser() user: User,
    @Query() dto: ExportTimesheetsDto,
    @Res() res: Response,
  ) {
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (from > to) {
      throw new BadRequestException('from must be before to');
    }

    const csv = await this.adminService.exportTimesheetCSV(
      user.organizationId,
      from,
      to,
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="timesheets-${dto.from}-to-${dto.to}.csv"`,
    );
    res.send(csv);
  }

  // ── User Management ───────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users in the organization' })
  async listUsers(@CurrentUser() user: User) {
    const list = await this.adminService.listUsers(user.organizationId);
    return { data: list };
  }

  @Patch('users/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate a user in the organization' })
  async deactivateUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    await this.adminService.deactivateUser(
      actor.organizationId,
      userId,
      actor.id,
    );
    await this.auditLogService.log(
      actor.organizationId,
      { id: actor.id, email: actor.email },
      'user.deactivated',
      'user',
      userId,
    );
    return { data: { success: true } };
  }

  @Patch('users/:id/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated user' })
  async reactivateUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) userId: string,
  ) {
    await this.adminService.reactivateUser(actor.organizationId, userId);
    await this.auditLogService.log(
      actor.organizationId,
      { id: actor.id, email: actor.email },
      'user.reactivated',
      'user',
      userId,
    );
    return { data: { success: true } };
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Change a user role' })
  async updateUserRole(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
  ) {
    await this.adminService.updateUserRole(
      actor.organizationId,
      userId,
      dto.role,
    );
    await this.auditLogService.log(
      actor.organizationId,
      { id: actor.id, email: actor.email },
      'user.role_changed',
      'user',
      userId,
      { newRole: dto.role },
    );
    return { data: { success: true } };
  }
}
