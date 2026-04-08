import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Attendance } from '../../database/entities/attendance.entity';
import {
  TimeEntry,
  TimeEntrySource,
} from '../../database/entities/time-entry.entity';
import {
  Timesheet,
  TimesheetStatus,
} from '../../database/entities/timesheet.entity';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import { ManualEntryDto } from './dto/manual-entry.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { UserRole } from '../../database/entities/user.entity';

@Injectable()
export class TimeTrackingService {
  constructor(
    @InjectRepository(Attendance)
    private attendanceRepo: Repository<Attendance>,
    @InjectRepository(TimeEntry)
    private timeEntryRepo: Repository<TimeEntry>,
    @InjectRepository(Timesheet)
    private timesheetRepo: Repository<Timesheet>,
  ) {}

  // ── Clock In ──────────────────────────────────────────────────────────

  async clockIn(
    userId: string,
    organizationId: string,
    dto: ClockInDto,
  ): Promise<Attendance> {
    const open = await this.attendanceRepo.findOne({
      where: { userId, organizationId, clockOut: null as any },
    });
    if (open) {
      throw new BadRequestException('Already clocked in');
    }

    const record = this.attendanceRepo.create({
      userId,
      organizationId,
      clockIn: new Date(),
      clockOut: null,
      locationLat: dto.locationLat ?? null,
      locationLng: dto.locationLng ?? null,
      note: dto.note ?? null,
    });
    return this.attendanceRepo.save(record);
  }

  // ── Clock Out ─────────────────────────────────────────────────────────

  async clockOut(
    userId: string,
    organizationId: string,
    dto: ClockOutDto,
  ): Promise<{ attendance: Attendance; entry: TimeEntry }> {
    const open = await this.attendanceRepo.findOne({
      where: { userId, organizationId, clockOut: null as any },
    });
    if (!open) {
      throw new BadRequestException('Not clocked in');
    }

    const now = new Date();
    open.clockOut = now;
    if (dto.note) open.note = dto.note;
    const attendance = await this.attendanceRepo.save(open);

    const entry = this.timeEntryRepo.create({
      userId,
      organizationId,
      attendanceId: open.id,
      startedAt: open.clockIn,
      endedAt: now,
      source: TimeEntrySource.AUTOMATIC,
    });
    const savedEntry = await this.timeEntryRepo.save(entry);

    return { attendance, entry: savedEntry };
  }

  // ── Status ────────────────────────────────────────────────────────────

  async getStatus(
    userId: string,
    organizationId: string,
  ): Promise<Attendance | null> {
    return this.attendanceRepo.findOne({
      where: { userId, organizationId, clockOut: null as any },
    });
  }

  // ── Attendance log ────────────────────────────────────────────────────

  async getAttendance(
    userId: string,
    organizationId: string,
    query: DateRangeQueryDto,
  ): Promise<Attendance[]> {
    const where: any = { userId, organizationId };
    if (query.from && query.to) {
      where.clockIn = Between(new Date(query.from), new Date(query.to));
    }
    return this.attendanceRepo.find({
      where,
      order: { clockIn: 'DESC' },
      take: 100,
    });
  }

  // ── Time entries ──────────────────────────────────────────────────────

  async getEntries(
    userId: string,
    organizationId: string,
    query: DateRangeQueryDto,
  ): Promise<TimeEntry[]> {
    const where: any = { userId, organizationId };
    if (query.from && query.to) {
      where.startedAt = Between(new Date(query.from), new Date(query.to));
    }
    return this.timeEntryRepo.find({
      where,
      order: { startedAt: 'DESC' },
      take: 200,
    });
  }

  async createManualEntry(
    userId: string,
    organizationId: string,
    dto: ManualEntryDto,
  ): Promise<TimeEntry> {
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);

    if (endedAt <= startedAt) {
      throw new BadRequestException('endedAt must be after startedAt');
    }

    const entry = this.timeEntryRepo.create({
      userId,
      organizationId,
      startedAt,
      endedAt,
      source: TimeEntrySource.MANUAL,
      description: dto.description ?? null,
    });
    return this.timeEntryRepo.save(entry);
  }

  async deleteEntry(
    id: string,
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const entry = await this.timeEntryRepo.findOne({
      where: { id, userId, organizationId },
    });
    if (!entry) throw new NotFoundException('Time entry not found');
    if (entry.source === TimeEntrySource.AUTOMATIC) {
      throw new BadRequestException('Automatic entries cannot be deleted');
    }
    await this.timeEntryRepo.delete({ id });
  }

  // ── Timesheets ────────────────────────────────────────────────────────

  async submitTimesheet(
    userId: string,
    organizationId: string,
    weekStart: string,
  ): Promise<Timesheet> {
    const existing = await this.timesheetRepo.findOne({
      where: { userId, organizationId, weekStart },
    });

    if (
      existing &&
      (existing.status === TimesheetStatus.APPROVED ||
        existing.status === TimesheetStatus.SUBMITTED)
    ) {
      throw new BadRequestException(
        `Timesheet is already ${existing.status}`,
      );
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const entries = await this.timeEntryRepo.find({
      where: {
        userId,
        organizationId,
        startedAt: Between(new Date(weekStart), weekEnd),
      },
    });

    const totalMinutes = entries.reduce((sum, e) => {
      if (!e.endedAt) return sum;
      return sum + Math.floor((e.endedAt.getTime() - e.startedAt.getTime()) / 60_000);
    }, 0);

    const sheet = existing
      ? Object.assign(existing, {
          totalMinutes,
          status: TimesheetStatus.SUBMITTED,
          submittedAt: new Date(),
        })
      : this.timesheetRepo.create({
          userId,
          organizationId,
          weekStart,
          totalMinutes,
          status: TimesheetStatus.SUBMITTED,
          submittedAt: new Date(),
        });

    return this.timesheetRepo.save(sheet);
  }

  async getTimesheets(
    userId: string,
    organizationId: string,
    role: UserRole,
  ): Promise<Timesheet[]> {
    const where: any = { organizationId };
    if (role === UserRole.EMPLOYEE) {
      where.userId = userId;
    }
    return this.timesheetRepo.find({
      where,
      order: { weekStart: 'DESC' },
      take: 52,
    });
  }

  async approveTimesheet(
    approverId: string,
    organizationId: string,
    timesheetId: string,
  ): Promise<Timesheet> {
    const sheet = await this.timesheetRepo.findOne({
      where: { id: timesheetId, organizationId },
    });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    if (sheet.status !== TimesheetStatus.SUBMITTED) {
      throw new BadRequestException(
        'Only submitted timesheets can be approved',
      );
    }

    sheet.status = TimesheetStatus.APPROVED;
    sheet.approvedBy = approverId;
    sheet.approvedAt = new Date();
    return this.timesheetRepo.save(sheet);
  }

  async rejectTimesheet(
    approverId: string,
    organizationId: string,
    timesheetId: string,
    rejectionNote: string,
  ): Promise<Timesheet> {
    const sheet = await this.timesheetRepo.findOne({
      where: { id: timesheetId, organizationId },
    });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    if (sheet.status !== TimesheetStatus.SUBMITTED) {
      throw new BadRequestException(
        'Only submitted timesheets can be rejected',
      );
    }

    sheet.status = TimesheetStatus.REJECTED;
    sheet.rejectionNote = rejectionNote;
    return this.timesheetRepo.save(sheet);
  }

  // ── Team status (manager/admin) ────────────────────────────────────────

  async getTeamStatus(organizationId: string): Promise<Attendance[]> {
    return this.attendanceRepo.find({
      where: { organizationId, clockOut: null as any },
      order: { clockIn: 'ASC' },
    });
  }

  // ── Team timesheets (manager/admin) ───────────────────────────────────

  async getTeamTimesheets(
    organizationId: string,
    query: { weekStart?: string; status?: string },
  ): Promise<Timesheet[]> {
    const where: any = { organizationId };
    if (query.weekStart) where.weekStart = query.weekStart;
    if (query.status) where.status = query.status as TimesheetStatus;

    return this.timesheetRepo.find({
      where,
      relations: ['user'],
      order: { weekStart: 'DESC', createdAt: 'DESC' },
      take: 500,
    });
  }

  // ── Payroll report (admin) ────────────────────────────────────────────

  async getPayrollReport(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<Array<{
    userId: string;
    firstName: string;
    lastName: string;
    weekStart: string;
    totalMinutes: number;
    overtimeMinutes: number;
    status: TimesheetStatus;
  }>> {
    const timesheets = await this.timesheetRepo.find({
      where: {
        organizationId,
        status: TimesheetStatus.APPROVED,
        weekStart: Between(from, to),
      },
      relations: ['user'],
      order: { weekStart: 'ASC' },
    });

    return timesheets.map((ts) => {
      const regularMinutes = Math.min(ts.totalMinutes, 8 * 5 * 60);
      const overtimeMinutes = Math.max(0, ts.totalMinutes - regularMinutes);
      return {
        userId: ts.userId,
        firstName: ts.user?.firstName ?? '',
        lastName: ts.user?.lastName ?? '',
        weekStart: ts.weekStart,
        totalMinutes: ts.totalMinutes,
        overtimeMinutes,
        status: ts.status,
      };
    });
  }
}
