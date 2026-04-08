import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TimeTrackingService } from './time-tracking.service';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry, TimeEntrySource } from '../../database/entities/time-entry.entity';
import { Timesheet, TimesheetStatus } from '../../database/entities/timesheet.entity';

type MockRepo<T> = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

function mockRepo<T>(): MockRepo<T> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
}

describe('TimeTrackingService', () => {
  let service: TimeTrackingService;
  let attendanceRepo: MockRepo<Attendance>;
  let timeEntryRepo: MockRepo<TimeEntry>;
  let timesheetRepo: MockRepo<Timesheet>;

  beforeEach(async () => {
    attendanceRepo = mockRepo<Attendance>();
    timeEntryRepo = mockRepo<TimeEntry>();
    timesheetRepo = mockRepo<Timesheet>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: getRepositoryToken(Attendance), useValue: attendanceRepo },
        { provide: getRepositoryToken(TimeEntry), useValue: timeEntryRepo },
        { provide: getRepositoryToken(Timesheet), useValue: timesheetRepo },
      ],
    }).compile();

    service = module.get<TimeTrackingService>(TimeTrackingService);
  });

  // ── clockIn ──────────────────────────────────────────────────────────
  describe('clockIn', () => {
    it('creates an attendance record when not already clocked in', async () => {
      attendanceRepo.findOne.mockResolvedValue(null);
      const record: Partial<Attendance> = {
        id: 'att-1',
        userId: 'u-1',
        organizationId: 'org-1',
        clockIn: new Date(),
        clockOut: null,
      };
      attendanceRepo.create.mockReturnValue(record);
      attendanceRepo.save.mockResolvedValue(record);

      const result = await service.clockIn('u-1', 'org-1', {});

      expect(attendanceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', organizationId: 'org-1' }),
      );
      expect(attendanceRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('att-1');
    });

    it('throws BadRequestException when already clocked in', async () => {
      attendanceRepo.findOne.mockResolvedValue({
        id: 'att-existing',
        clockOut: null,
      });

      await expect(service.clockIn('u-1', 'org-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── clockOut ─────────────────────────────────────────────────────────
  describe('clockOut', () => {
    it('closes attendance and creates a time entry', async () => {
      const clockInTime = new Date(Date.now() - 3_600_000);
      const open: Partial<Attendance> = {
        id: 'att-1',
        userId: 'u-1',
        organizationId: 'org-1',
        clockIn: clockInTime,
        clockOut: null,
      };
      attendanceRepo.findOne.mockResolvedValue(open);
      const closed = { ...open, clockOut: new Date() };
      attendanceRepo.save.mockResolvedValue(closed);

      const entry: Partial<TimeEntry> = { id: 'te-1' };
      timeEntryRepo.create.mockReturnValue(entry);
      timeEntryRepo.save.mockResolvedValue(entry);

      const result = await service.clockOut('u-1', 'org-1', {});

      expect(attendanceRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ clockOut: expect.any(Date) }),
      );
      expect(timeEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attendanceId: 'att-1',
          startedAt: clockInTime,
          source: TimeEntrySource.AUTOMATIC,
        }),
      );
      expect(result.attendance.id).toBe('att-1');
    });

    it('throws BadRequestException when not clocked in', async () => {
      attendanceRepo.findOne.mockResolvedValue(null);

      await expect(service.clockOut('u-1', 'org-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── createManualEntry ────────────────────────────────────────────────
  describe('createManualEntry', () => {
    it('creates a manual time entry', async () => {
      const entry: Partial<TimeEntry> = {
        id: 'te-manual-1',
        source: TimeEntrySource.MANUAL,
      };
      timeEntryRepo.create.mockReturnValue(entry);
      timeEntryRepo.save.mockResolvedValue(entry);

      const dto = {
        startedAt: '2026-04-01T09:00:00.000Z',
        endedAt: '2026-04-01T17:00:00.000Z',
        description: 'Deep work',
      };

      const result = await service.createManualEntry('u-1', 'org-1', dto);

      expect(timeEntryRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: TimeEntrySource.MANUAL,
          description: 'Deep work',
        }),
      );
      expect(result.id).toBe('te-manual-1');
    });

    it('throws BadRequestException when endedAt is before startedAt', async () => {
      const dto = {
        startedAt: '2026-04-01T17:00:00.000Z',
        endedAt: '2026-04-01T09:00:00.000Z',
      };

      await expect(
        service.createManualEntry('u-1', 'org-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── submitTimesheet ──────────────────────────────────────────────────
  describe('submitTimesheet', () => {
    it('calculates total minutes from entries and sets status to submitted', async () => {
      timesheetRepo.findOne.mockResolvedValue(null);

      const entries: Partial<TimeEntry>[] = [
        {
          startedAt: new Date('2026-03-31T09:00:00Z'),
          endedAt: new Date('2026-03-31T17:00:00Z'), // 480 min
        },
        {
          startedAt: new Date('2026-04-01T09:00:00Z'),
          endedAt: new Date('2026-04-01T13:00:00Z'), // 240 min
        },
      ];
      timeEntryRepo.find.mockResolvedValue(entries);

      const sheet: Partial<Timesheet> = {
        id: 'ts-1',
        totalMinutes: 720,
        status: TimesheetStatus.SUBMITTED,
        submittedAt: new Date(),
      };
      timesheetRepo.create.mockReturnValue(sheet);
      timesheetRepo.save.mockResolvedValue(sheet);

      const result = await service.submitTimesheet('u-1', 'org-1', '2026-03-31');

      expect(timesheetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ totalMinutes: 720 }),
      );
      expect(result.totalMinutes).toBe(720);
      expect(result.status).toBe(TimesheetStatus.SUBMITTED);
    });

    it('throws BadRequestException when timesheet is already approved', async () => {
      timesheetRepo.findOne.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.APPROVED,
      });

      await expect(
        service.submitTimesheet('u-1', 'org-1', '2026-03-31'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── approveTimesheet ────────────────────────────────────────────────
  describe('approveTimesheet', () => {
    it('approves a submitted timesheet', async () => {
      const sheet: Partial<Timesheet> = {
        id: 'ts-1',
        status: TimesheetStatus.SUBMITTED,
      };
      timesheetRepo.findOne.mockResolvedValue(sheet);
      const approved = {
        ...sheet,
        status: TimesheetStatus.APPROVED,
        approvedBy: 'mgr-1',
        approvedAt: new Date(),
      };
      timesheetRepo.save.mockResolvedValue(approved);

      const result = await service.approveTimesheet('mgr-1', 'org-1', 'ts-1');

      expect(result.status).toBe(TimesheetStatus.APPROVED);
      expect(result.approvedBy).toBe('mgr-1');
    });

    it('throws BadRequestException when timesheet is not submitted', async () => {
      timesheetRepo.findOne.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      });

      await expect(
        service.approveTimesheet('mgr-1', 'org-1', 'ts-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when timesheet does not exist', async () => {
      timesheetRepo.findOne.mockResolvedValue(null);

      await expect(
        service.approveTimesheet('mgr-1', 'org-1', 'no-such-id'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── rejectTimesheet ──────────────────────────────────────────────────
  describe('rejectTimesheet', () => {
    it('rejects a submitted timesheet with a note', async () => {
      timesheetRepo.findOne.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.SUBMITTED,
      });
      const rejected = {
        id: 'ts-1',
        status: TimesheetStatus.REJECTED,
        rejectionNote: 'Missing hours',
      };
      timesheetRepo.save.mockResolvedValue(rejected);

      const result = await service.rejectTimesheet(
        'mgr-1',
        'org-1',
        'ts-1',
        'Missing hours',
      );

      expect(result.status).toBe(TimesheetStatus.REJECTED);
      expect(result.rejectionNote).toBe('Missing hours');
    });

    it('throws BadRequestException when timesheet is not submitted', async () => {
      timesheetRepo.findOne.mockResolvedValue({
        id: 'ts-1',
        status: TimesheetStatus.DRAFT,
      });

      await expect(
        service.rejectTimesheet('mgr-1', 'org-1', 'ts-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

// ── New TDD tests for getTeamTimesheets and getPayrollReport ─────────────

const mockTimesheetRepo2 = {
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
};
const mockAttendanceRepo2 = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
const mockEntryRepo2 = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn(), delete: jest.fn() };

const orgId = 'org-uuid';
const userId1 = 'user-1';
const userId2 = 'user-2';

const mockTimesheets: Partial<Timesheet>[] = [
  {
    id: 'ts-1', userId: userId1, organizationId: orgId,
    weekStart: '2026-03-30', totalMinutes: 2400,
    status: TimesheetStatus.SUBMITTED, submittedAt: new Date(),
    approvedBy: null, approvedAt: null, rejectionNote: null,
    user: { id: userId1, firstName: 'Alice', lastName: 'Jones' } as any,
  },
  {
    id: 'ts-2', userId: userId2, organizationId: orgId,
    weekStart: '2026-03-30', totalMinutes: 1800,
    status: TimesheetStatus.APPROVED, submittedAt: new Date(),
    approvedBy: 'admin-id', approvedAt: new Date(), rejectionNote: null,
    user: { id: userId2, firstName: 'Bob', lastName: 'Smith' } as any,
  },
];

describe('TimeTrackingService.getTeamTimesheets', () => {
  let service: TimeTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: getRepositoryToken(Timesheet), useValue: mockTimesheetRepo2 },
        { provide: getRepositoryToken(Attendance), useValue: mockAttendanceRepo2 },
        { provide: getRepositoryToken(TimeEntry), useValue: mockEntryRepo2 },
      ],
    }).compile();
    service = module.get<TimeTrackingService>(TimeTrackingService);
    jest.clearAllMocks();
  });

  it('returns all timesheets for the org', async () => {
    mockTimesheetRepo2.find.mockResolvedValue(mockTimesheets);
    const result = await service.getTeamTimesheets(orgId, {});
    expect(result).toHaveLength(2);
    expect(mockTimesheetRepo2.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: orgId }) }),
    );
  });

  it('filters by weekStart when provided', async () => {
    mockTimesheetRepo2.find.mockResolvedValue([mockTimesheets[0]]);
    const result = await service.getTeamTimesheets(orgId, { weekStart: '2026-03-30' });
    expect(result).toHaveLength(1);
    expect(mockTimesheetRepo2.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ weekStart: '2026-03-30' }) }),
    );
  });

  it('filters by status when provided', async () => {
    mockTimesheetRepo2.find.mockResolvedValue([mockTimesheets[0]]);
    await service.getTeamTimesheets(orgId, { status: 'submitted' });
    expect(mockTimesheetRepo2.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: TimesheetStatus.SUBMITTED }) }),
    );
  });
});

describe('TimeTrackingService.getPayrollReport', () => {
  let service: TimeTrackingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeTrackingService,
        { provide: getRepositoryToken(Timesheet), useValue: mockTimesheetRepo2 },
        { provide: getRepositoryToken(Attendance), useValue: mockAttendanceRepo2 },
        { provide: getRepositoryToken(TimeEntry), useValue: mockEntryRepo2 },
      ],
    }).compile();
    service = module.get<TimeTrackingService>(TimeTrackingService);
    jest.clearAllMocks();
  });

  it('returns payroll rows for approved timesheets', async () => {
    mockTimesheetRepo2.find.mockResolvedValue([mockTimesheets[1]]);
    const result = await service.getPayrollReport(orgId, '2026-03-30', '2026-04-05');
    expect(result).toHaveLength(1);
    expect(result[0].totalMinutes).toBe(1800);
    expect(result[0].userId).toBe(userId2);
  });

  it('returns empty array when no approved timesheets', async () => {
    mockTimesheetRepo2.find.mockResolvedValue([]);
    const result = await service.getPayrollReport(orgId, '2026-03-30', '2026-04-05');
    expect(result).toHaveLength(0);
  });
});
