import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { TimeTrackingService } from './time-tracking.service';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { RejectTimesheetDto } from './dto/reject-timesheet.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User, UserRole } from '../../database/entities/user.entity';

@ApiTags('Time Tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('time-tracking')
export class TimeTrackingController {
  constructor(private readonly service: TimeTrackingService) {}

  // ── Clock ───────────────────────────────────────────────────────────

  @Post('clock-in')
  @ApiOperation({ summary: 'Clock in — start a work session' })
  clockIn(@CurrentUser() user: User, @Body() dto: ClockInDto) {
    return this.service.clockIn(user.id, user.organizationId, dto);
  }

  @Post('clock-out')
  @ApiOperation({ summary: 'Clock out — end the current work session' })
  clockOut(@CurrentUser() user: User, @Body() dto: ClockOutDto) {
    return this.service.clockOut(user.id, user.organizationId, dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current clock-in status' })
  getStatus(@CurrentUser() user: User) {
    return this.service.getStatus(user.id, user.organizationId);
  }

  // ── Attendance log ───────────────────────────────────────────────────

  @Get('attendance')
  @ApiOperation({ summary: 'List attendance records for the current user' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getAttendance(@CurrentUser() user: User, @Query() query: DateRangeQueryDto) {
    return this.service.getAttendance(user.id, user.organizationId, query);
  }

  // ── Time entries ─────────────────────────────────────────────────────

  @Get('entries')
  @ApiOperation({ summary: 'List time entries for the current user' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  getEntries(@CurrentUser() user: User, @Query() query: DateRangeQueryDto) {
    return this.service.getEntries(user.id, user.organizationId, query);
  }

  @Post('entries')
  @ApiOperation({ summary: 'Create a manual time entry' })
  createEntry(@CurrentUser() user: User, @Body() dto: ManualEntryDto) {
    return this.service.createManualEntry(user.id, user.organizationId, dto);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a manual time entry' })
  deleteEntry(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.deleteEntry(id, user.id, user.organizationId);
  }

  // ── Timesheets ───────────────────────────────────────────────────────

  @Get('timesheets')
  @ApiOperation({
    summary:
      'List timesheets. Employees see their own; managers/admins see all.',
  })
  getTimesheets(@CurrentUser() user: User) {
    return this.service.getTimesheets(
      user.id,
      user.organizationId,
      user.role,
    );
  }

  @Post('timesheets/:weekStart/submit')
  @ApiOperation({ summary: 'Submit the weekly timesheet for approval' })
  submitTimesheet(
    @CurrentUser() user: User,
    @Param('weekStart') weekStart: string,
  ) {
    return this.service.submitTimesheet(
      user.id,
      user.organizationId,
      weekStart,
    );
  }

  @Post('timesheets/:id/approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Approve a submitted timesheet (manager/admin)' })
  approveTimesheet(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.approveTimesheet(user.id, user.organizationId, id);
  }

  @Post('timesheets/:id/reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject a submitted timesheet (manager/admin)' })
  rejectTimesheet(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectTimesheetDto,
  ) {
    return this.service.rejectTimesheet(
      user.id,
      user.organizationId,
      id,
      dto.rejectionNote,
    );
  }

  // ── Team view (manager/admin) ────────────────────────────────────────

  @Get('team/timesheets')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'All team timesheets for org (manager/admin)' })
  @ApiQuery({ name: 'weekStart', required: false, description: 'YYYY-MM-DD Monday' })
  @ApiQuery({ name: 'status', required: false, enum: ['draft', 'submitted', 'approved', 'rejected'] })
  getTeamTimesheets(
    @CurrentUser() user: User,
    @Query() query: { weekStart?: string; status?: string },
  ) {
    return this.service.getTeamTimesheets(user.organizationId, query);
  }

  @Get('report')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Payroll summary for approved timesheets in date range' })
  @ApiQuery({ name: 'from', required: true, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, description: 'YYYY-MM-DD' })
  getPayrollReport(
    @CurrentUser() user: User,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.getPayrollReport(user.organizationId, from, to);
  }

  @Get('export')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Download approved timesheets as CSV' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  async exportPayrollCsv(
    @CurrentUser() user: User,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) res: import('express').Response,
  ): Promise<string> {
    const rows = await this.service.getPayrollReport(user.organizationId, from, to);
    const header = 'Employee,Week Start,Total Hours,Overtime Hours,Status';
    const lines = rows.map((r) =>
      [
        `"${r.firstName} ${r.lastName}"`,
        r.weekStart,
        (r.totalMinutes / 60).toFixed(2),
        (r.overtimeMinutes / 60).toFixed(2),
        r.status,
      ].join(','),
    );
    const csv = [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${from}-${to}.csv"`);
    return csv;
  }

  @Get('team/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Get all currently clocked-in employees (manager/admin)',
  })
  getTeamStatus(@CurrentUser() user: User) {
    return this.service.getTeamStatus(user.organizationId);
  }
}
