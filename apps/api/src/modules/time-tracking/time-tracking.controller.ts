import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
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

  @Get('team/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Get all currently clocked-in employees (manager/admin)',
  })
  getTeamStatus(@CurrentUser() user: User) {
    return this.service.getTeamStatus(user.organizationId);
  }
}
