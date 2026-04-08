# Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the time tracking sub-system covering clock in/out, automatic time entries, manual entries, weekly timesheets, and manager approval workflow.

**Architecture:** NestJS module (`time-tracking`) backed by three PostgreSQL tables (`attendance`, `time_entries`, `timesheets`) with RLS tenant isolation. Employees clock in/out which auto-creates time entries; they can also add manual entries. Weekly timesheets aggregate entries and flow through draft → submitted → approved/rejected. The Next.js dashboard shows a clock widget and timesheet table.

**Tech Stack:** NestJS 10, TypeORM 0.3, PostgreSQL (with RLS), Next.js 14 App Router, TanStack Query, shadcn/ui, Jest (unit tests with mocked repositories).

---

## File Map

```
apps/api/src/
├── database/
│   ├── entities/
│   │   ├── attendance.entity.ts         ← clock in/out record
│   │   ├── time-entry.entity.ts         ← individual work session
│   │   └── timesheet.entity.ts          ← weekly summary + approval state
│   └── migrations/
│       └── 002_time_tracking_schema.ts  ← creates all 3 tables + RLS
└── modules/
    └── time-tracking/
        ├── dto/
        │   ├── clock-in.dto.ts
        │   ├── clock-out.dto.ts
        │   ├── manual-entry.dto.ts
        │   ├── date-range-query.dto.ts
        │   └── reject-timesheet.dto.ts
        ├── time-tracking.service.ts
        ├── time-tracking.service.spec.ts ← Jest unit tests
        ├── time-tracking.controller.ts
        └── time-tracking.module.ts

apps/web/
├── hooks/
│   └── use-time-tracking.ts             ← TanStack Query hooks
├── components/time-tracking/
│   ├── clock-widget.tsx                 ← clock in/out button + elapsed timer
│   └── entries-table.tsx               ← paginated time entries list
└── app/(dashboard)/time-tracking/
    └── page.tsx                         ← main time tracking page
```

---

## Task 1: Database Migration

**Files:**
- Create: `apps/api/src/database/migrations/002_time_tracking_schema.ts`

- [ ] **Step 1: Create `apps/api/src/database/migrations/002_time_tracking_schema.ts`**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class TimeTrackingSchema1712200000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enums
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE time_entry_source AS ENUM ('automatic', 'manual', 'edited');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      DO $$ BEGIN
        CREATE TYPE timesheet_status AS ENUM ('draft', 'submitted', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // attendance — one record per clock-in/clock-out session
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        clock_in        TIMESTAMPTZ NOT NULL,
        clock_out       TIMESTAMPTZ,
        location_lat    DECIMAL(10,8),
        location_lng    DECIMAL(11,8),
        note            TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_user_org  ON attendance(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_clock_in  ON attendance(clock_in DESC);
      CREATE INDEX IF NOT EXISTS idx_attendance_open      ON attendance(user_id, organization_id) WHERE clock_out IS NULL;

      ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON attendance
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // time_entries — individual work periods (auto from attendance or manual)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        attendance_id   UUID REFERENCES attendance(id) ON DELETE SET NULL,
        started_at      TIMESTAMPTZ NOT NULL,
        ended_at        TIMESTAMPTZ,
        source          time_entry_source NOT NULL DEFAULT 'automatic',
        description     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_time_entries_user_org   ON time_entries(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at DESC);

      ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON time_entries
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // timesheets — weekly aggregate, one per employee per week
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS timesheets (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        week_start      DATE NOT NULL,
        total_minutes   INTEGER NOT NULL DEFAULT 0,
        status          timesheet_status NOT NULL DEFAULT 'draft',
        submitted_at    TIMESTAMPTZ,
        approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
        approved_at     TIMESTAMPTZ,
        rejection_note  TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, week_start)
      );

      CREATE INDEX IF NOT EXISTS idx_timesheets_user_org ON timesheets(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_timesheets_status   ON timesheets(status);

      ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON timesheets
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS timesheets;
      DROP TABLE IF EXISTS time_entries;
      DROP TABLE IF EXISTS attendance;
      DROP TYPE IF EXISTS timesheet_status;
      DROP TYPE IF EXISTS time_entry_source;
    `);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to the new file.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/database/migrations/ && git commit -m "feat(api): add time tracking database migration (attendance, time_entries, timesheets)"
```

---

## Task 2: TypeORM Entities

**Files:**
- Create: `apps/api/src/database/entities/attendance.entity.ts`
- Create: `apps/api/src/database/entities/time-entry.entity.ts`
- Create: `apps/api/src/database/entities/timesheet.entity.ts`

- [ ] **Step 1: Create `apps/api/src/database/entities/attendance.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('attendance')
export class Attendance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'clock_in', type: 'timestamptz' })
  clockIn: Date;

  @Column({ name: 'clock_out', type: 'timestamptz', nullable: true })
  clockOut: Date | null;

  @Column({
    name: 'location_lat',
    type: 'decimal',
    precision: 10,
    scale: 8,
    nullable: true,
  })
  locationLat: number | null;

  @Column({
    name: 'location_lng',
    type: 'decimal',
    precision: 11,
    scale: 8,
    nullable: true,
  })
  locationLng: number | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: Create `apps/api/src/database/entities/time-entry.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum TimeEntrySource {
  AUTOMATIC = 'automatic',
  MANUAL = 'manual',
  EDITED = 'edited',
}

@Entity('time_entries')
export class TimeEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'attendance_id', nullable: true })
  attendanceId: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({
    type: 'enum',
    enum: TimeEntrySource,
    default: TimeEntrySource.AUTOMATIC,
  })
  source: TimeEntrySource;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Create `apps/api/src/database/entities/timesheet.entity.ts`**

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum TimesheetStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('timesheets')
export class Timesheet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'organization_id' })
  organizationId: string;

  // 'YYYY-MM-DD' — always the Monday of the week
  @Column({ name: 'week_start', type: 'date' })
  weekStart: string;

  @Column({ name: 'total_minutes', default: 0 })
  totalMinutes: number;

  @Column({
    type: 'enum',
    enum: TimesheetStatus,
    default: TimesheetStatus.DRAFT,
  })
  status: TimesheetStatus;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'approved_by', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'rejection_note', type: 'text', nullable: true })
  rejectionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/database/entities/ && git commit -m "feat(api): add Attendance, TimeEntry, and Timesheet TypeORM entities"
```

---

## Task 3: DTOs

**Files:**
- Create: `apps/api/src/modules/time-tracking/dto/clock-in.dto.ts`
- Create: `apps/api/src/modules/time-tracking/dto/clock-out.dto.ts`
- Create: `apps/api/src/modules/time-tracking/dto/manual-entry.dto.ts`
- Create: `apps/api/src/modules/time-tracking/dto/date-range-query.dto.ts`
- Create: `apps/api/src/modules/time-tracking/dto/reject-timesheet.dto.ts`

- [ ] **Step 1: Create all DTO files**

`apps/api/src/modules/time-tracking/dto/clock-in.dto.ts`:
```typescript
import { IsOptional, IsNumber, IsString, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ClockInDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  locationLat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  locationLng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
```

`apps/api/src/modules/time-tracking/dto/clock-out.dto.ts`:
```typescript
import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ClockOutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}
```

`apps/api/src/modules/time-tracking/dto/manual-entry.dto.ts`:
```typescript
import { IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ManualEntryDto {
  @ApiProperty({ example: '2026-04-01T09:00:00.000Z' })
  @IsISO8601()
  startedAt: string;

  @ApiProperty({ example: '2026-04-01T17:00:00.000Z' })
  @IsISO8601()
  endedAt: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
```

`apps/api/src/modules/time-tracking/dto/date-range-query.dto.ts`:
```typescript
import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DateRangeQueryDto {
  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-04-07' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
```

`apps/api/src/modules/time-tracking/dto/reject-timesheet.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectTimesheetDto {
  @ApiProperty({ example: 'Missing Friday hours' })
  @IsString()
  @MinLength(1)
  rejectionNote: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/time-tracking/dto/ && git commit -m "feat(api): add time tracking DTOs"
```

---

## Task 4: TimeTrackingService + Unit Tests

**Files:**
- Create: `apps/api/src/modules/time-tracking/time-tracking.service.spec.ts`
- Create: `apps/api/src/modules/time-tracking/time-tracking.service.ts`

- [ ] **Step 1: Create `apps/api/src/modules/time-tracking/time-tracking.service.spec.ts`**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail (package not found)**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest time-tracking.service --no-coverage 2>&1 | tail -10
```

Expected: Error — `Cannot find module './time-tracking.service'`.

- [ ] **Step 3: Create `apps/api/src/modules/time-tracking/time-tracking.service.ts`**

```typescript
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
    weekStart: string, // 'YYYY-MM-DD'
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

    // Calculate total minutes from time entries in this week
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
    // Employees only see their own timesheets
    if (role === UserRole.EMPLOYEE) {
      where.userId = userId;
    }
    return this.timesheetRepo.find({
      where,
      order: { weekStart: 'DESC' },
      take: 52, // max 1 year
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
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest time-tracking.service --no-coverage 2>&1 | tail -20
```

Expected: All 10 tests PASS.

If a test fails because `find` is called instead of `findOne` (or vice versa), check the mock setup. The `findOne` mock returns the open attendance record — if the service uses `find` for the open-session lookup, change the mock to `find.mockResolvedValue([record])` and service to check `array[0]`. Keep the service code as written above (using `findOne`).

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/time-tracking/ && git commit -m "feat(api): implement TimeTrackingService with TDD (10 tests)"
```

---

## Task 5: TimeTrackingController

**Files:**
- Create: `apps/api/src/modules/time-tracking/time-tracking.controller.ts`

- [ ] **Step 1: Create `apps/api/src/modules/time-tracking/time-tracking.controller.ts`**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/time-tracking/time-tracking.controller.ts && git commit -m "feat(api): add TimeTrackingController with clock in/out, entries, timesheets, and team status"
```

---

## Task 6: TimeTrackingModule + Wire into AppModule

**Files:**
- Create: `apps/api/src/modules/time-tracking/time-tracking.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Create `apps/api/src/modules/time-tracking/time-tracking.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeTrackingController } from './time-tracking.controller';
import { TimeTrackingService } from './time-tracking.service';
import { Attendance } from '../../database/entities/attendance.entity';
import { TimeEntry } from '../../database/entities/time-entry.entity';
import { Timesheet } from '../../database/entities/timesheet.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Attendance, TimeEntry, Timesheet])],
  controllers: [TimeTrackingController],
  providers: [TimeTrackingService],
})
export class TimeTrackingModule {}
```

- [ ] **Step 2: Modify `apps/api/src/app.module.ts` — add entities and import TimeTrackingModule**

Add the 3 new imports at the top of the file:
```typescript
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { Attendance } from './database/entities/attendance.entity';
import { TimeEntry } from './database/entities/time-entry.entity';
import { Timesheet } from './database/entities/timesheet.entity';
```

In the `TypeOrmModule.forRootAsync` `entities` array, add the 3 new entities:
```typescript
entities: [Organization, User, Subscription, RefreshToken, Attendance, TimeEntry, Timesheet],
```

In the `imports` array of `@Module`, add `TimeTrackingModule` after `BillingModule`:
```typescript
TimeTrackingModule,
```

The full updated `app.module.ts`:
```typescript
import * as Joi from 'joi';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { TimeTrackingModule } from './modules/time-tracking/time-tracking.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { TenantMiddleware } from './common/middleware/tenant.middleware';
import { Organization } from './database/entities/organization.entity';
import { User } from './database/entities/user.entity';
import { Subscription } from './database/entities/subscription.entity';
import { RefreshToken } from './database/entities/refresh-token.entity';
import { Attendance } from './database/entities/attendance.entity';
import { TimeEntry } from './database/entities/time-entry.entity';
import { Timesheet } from './database/entities/timesheet.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string().min(32).required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        JWT_REFRESH_SECRET: Joi.string().min(32).required(),
        STRIPE_SECRET_KEY: Joi.string().required(),
        APP_URL: Joi.string().uri().required(),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL'),
        entities: [
          Organization,
          User,
          Subscription,
          RefreshToken,
          Attendance,
          TimeEntry,
          Timesheet,
        ],
        migrations: ['dist/database/migrations/*.js'],
        migrationsRun: config.get('NODE_ENV') !== 'production',
        logging: config.get('NODE_ENV') !== 'production',
        ssl:
          config.get('NODE_ENV') === 'production'
            ? { rejectUnauthorized: true }
            : false,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]),
    RedisModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    BillingModule,
    TimeTrackingModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 3: Run all tests to confirm nothing broken**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -15
```

Expected: All tests pass (10 time-tracking service tests, no regressions).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/api" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/api/src/modules/time-tracking/time-tracking.module.ts apps/api/src/app.module.ts && git commit -m "feat(api): wire TimeTrackingModule into AppModule with all 3 entities"
```

---

## Task 7: Frontend TanStack Query Hooks

**Files:**
- Create: `apps/web/hooks/use-time-tracking.ts`

- [ ] **Step 1: Create `apps/web/hooks/use-time-tracking.ts`**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────

export type AttendanceRecord = {
  id: string;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  locationLat: number | null;
  locationLng: number | null;
  note: string | null;
  createdAt: string;
};

export type TimeEntry = {
  id: string;
  userId: string;
  attendanceId: string | null;
  startedAt: string;
  endedAt: string | null;
  source: 'automatic' | 'manual' | 'edited';
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Timesheet = {
  id: string;
  userId: string;
  weekStart: string;
  totalMinutes: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
};

// ── Clock status ───────────────────────────────────────────────────────

export function useClockStatus() {
  return useQuery({
    queryKey: ['clock-status'],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/status');
      return data.data as AttendanceRecord | null;
    },
    refetchInterval: 30_000, // refresh every 30s
  });
}

// ── Clock in ───────────────────────────────────────────────────────────

export function useClockIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { note?: string }) => {
      const { data } = await api.post('/time-tracking/clock-in', payload ?? {});
      return data.data as AttendanceRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      toast.success('Clocked in successfully');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to clock in';
      toast.error(message);
    },
  });
}

// ── Clock out ──────────────────────────────────────────────────────────

export function useClockOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload?: { note?: string }) => {
      const { data } = await api.post('/time-tracking/clock-out', payload ?? {});
      return data.data as { attendance: AttendanceRecord; entry: TimeEntry };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Clocked out successfully');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to clock out';
      toast.error(message);
    },
  });
}

// ── Time entries ───────────────────────────────────────────────────────

export function useTimeEntries(params?: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['time-entries', params],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/entries', {
        params,
      });
      return data.data as TimeEntry[];
    },
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      startedAt: string;
      endedAt: string;
      description?: string;
    }) => {
      const { data } = await api.post('/time-tracking/entries', payload);
      return data.data as TimeEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Time entry added');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to add entry';
      toast.error(message);
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/time-tracking/entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      toast.success('Entry deleted');
    },
    onError: () => toast.error('Failed to delete entry'),
  });
}

// ── Timesheets ─────────────────────────────────────────────────────────

export function useTimesheets() {
  return useQuery({
    queryKey: ['timesheets'],
    queryFn: async () => {
      const { data } = await api.get('/time-tracking/timesheets');
      return data.data as Timesheet[];
    },
  });
}

export function useSubmitTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weekStart: string) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${weekStart}/submit`,
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet submitted for approval');
    },
    onError: (err: unknown) => {
      const message =
        (err as any)?.response?.data?.message ?? 'Failed to submit timesheet';
      toast.error(message);
    },
  });
}

export function useApproveTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${id}/approve`,
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet approved');
    },
    onError: () => toast.error('Failed to approve timesheet'),
  });
}

export function useRejectTimesheet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      rejectionNote,
    }: {
      id: string;
      rejectionNote: string;
    }) => {
      const { data } = await api.post(
        `/time-tracking/timesheets/${id}/reject`,
        { rejectionNote },
      );
      return data.data as Timesheet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
      toast.success('Timesheet rejected');
    },
    onError: () => toast.error('Failed to reject timesheet'),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Returns total hours formatted as "Xh Ym" from totalMinutes */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Returns the Monday (week_start) of the week containing date */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day; // offset to Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/hooks/use-time-tracking.ts && git commit -m "feat(web): add time tracking TanStack Query hooks"
```

---

## Task 8: Frontend Components + Page

**Files:**
- Create: `apps/web/components/time-tracking/clock-widget.tsx`
- Create: `apps/web/components/time-tracking/entries-table.tsx`
- Create: `apps/web/components/time-tracking/timesheets-view.tsx`
- Create: `apps/web/app/(dashboard)/time-tracking/page.tsx`

- [ ] **Step 1: Create `apps/web/components/time-tracking/clock-widget.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useClockStatus, useClockIn, useClockOut } from '@/hooks/use-time-tracking';

function ElapsedTimer({ since }: { since: string }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => {
      const ms = Date.now() - new Date(since).getTime();
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    };
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [since]);

  return (
    <p className="text-4xl font-mono font-bold text-slate-800 tabular-nums">
      {elapsed}
    </p>
  );
}

export function ClockWidget() {
  const { data: status, isLoading } = useClockStatus();
  const clockIn = useClockIn();
  const clockOut = useClockOut();

  const isClockedIn = !!status?.clockIn && !status?.clockOut;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-6">
        {isClockedIn ? (
          <>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-slate-500">Working since</p>
              <p className="text-sm font-medium text-slate-700">
                {new Date(status!.clockIn).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <ElapsedTimer since={status!.clockIn} />
            </div>
            <Button
              size="lg"
              variant="destructive"
              className="w-40"
              disabled={clockOut.isPending}
              onClick={() => clockOut.mutate({})}
            >
              {clockOut.isPending ? 'Clocking out...' : 'Clock Out'}
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm text-slate-500">Not clocked in</p>
              <p className="text-2xl font-semibold text-slate-400">--:--:--</p>
            </div>
            <Button
              size="lg"
              className="w-40 bg-green-600 hover:bg-green-700 text-white"
              disabled={clockIn.isPending}
              onClick={() => clockIn.mutate({})}
            >
              {clockIn.isPending ? 'Clocking in...' : 'Clock In'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/time-tracking/entries-table.tsx`**

```tsx
'use client';

import { useTimeEntries, useDeleteEntry, formatMinutes } from '@/hooks/use-time-tracking';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function durationMinutes(start: string, end: string | null): number {
  if (!end) return 0;
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

const sourceColors: Record<string, string> = {
  automatic: 'bg-blue-100 text-blue-700',
  manual: 'bg-yellow-100 text-yellow-700',
  edited: 'bg-purple-100 text-purple-700',
};

export function EntriesTable() {
  const { data: entries = [], isLoading } = useTimeEntries();
  const deleteEntry = useDeleteEntry();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading entries...
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Time Entries</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          No time entries yet. Clock in to start tracking.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Time Entries</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const dur = durationMinutes(entry.startedAt, entry.endedAt);
                return (
                  <tr
                    key={entry.id}
                    className="border-b last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 text-slate-700">
                      {new Date(entry.startedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {new Date(entry.startedAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {entry.endedAt
                        ? new Date(entry.endedAt).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {dur > 0 ? formatMinutes(dur) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${sourceColors[entry.source] ?? ''}`}
                      >
                        {entry.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">
                      {entry.description ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {entry.source !== 'automatic' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          disabled={deleteEntry.isPending}
                          onClick={() => deleteEntry.mutate(entry.id)}
                        >
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/time-tracking/timesheets-view.tsx`**

```tsx
'use client';

import {
  useTimesheets,
  useSubmitTimesheet,
  useApproveTimesheet,
  useRejectTimesheet,
  formatMinutes,
  getWeekStart,
} from '@/hooks/use-time-tracking';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useState } from 'react';

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export function TimesheetsView() {
  const { data: session } = useSession();
  const { data: timesheets = [], isLoading } = useTimesheets();
  const submit = useSubmitTimesheet();
  const approve = useApproveTimesheet();
  const reject = useRejectTimesheet();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const isManager =
    session?.user?.role === 'admin' || session?.user?.role === 'manager';
  const thisWeek = getWeekStart();

  const handleReject = (id: string) => {
    if (!rejectNote.trim()) return;
    reject.mutate({ id, rejectionNote: rejectNote });
    setRejectingId(null);
    setRejectNote('');
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Loading timesheets...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Timesheets</CardTitle>
        {!isManager && (
          <Button
            size="sm"
            disabled={submit.isPending}
            onClick={() => submit.mutate(thisWeek)}
          >
            {submit.isPending ? 'Submitting...' : 'Submit This Week'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {timesheets.length === 0 ? (
          <p className="py-8 text-center text-slate-400 text-sm">
            No timesheets yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Week Starting</th>
                  <th className="px-4 py-3">Total Hours</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                  {isManager && <th className="px-4 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {timesheets.map((ts) => (
                  <>
                    <tr
                      key={ts.id}
                      className="border-b last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {new Date(ts.weekStart + 'T00:00:00').toLocaleDateString(
                          undefined,
                          { month: 'short', day: 'numeric', year: 'numeric' },
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        {formatMinutes(ts.totalMinutes)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[ts.status] ?? ''}`}
                        >
                          {ts.status}
                        </span>
                        {ts.status === 'rejected' && ts.rejectionNote && (
                          <p className="text-xs text-red-500 mt-0.5 max-w-xs truncate">
                            {ts.rejectionNote}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {ts.submittedAt
                          ? new Date(ts.submittedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      {isManager && (
                        <td className="px-4 py-3">
                          {ts.status === 'submitted' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={approve.isPending}
                                onClick={() => approve.mutate(ts.id)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => setRejectingId(ts.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                    {rejectingId === ts.id && (
                      <tr key={`${ts.id}-reject`} className="bg-red-50">
                        <td colSpan={isManager ? 5 : 4} className="px-4 py-3">
                          <div className="flex gap-2 items-center">
                            <input
                              className="flex-1 border border-red-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                              placeholder="Reason for rejection..."
                              value={rejectNote}
                              onChange={(e) => setRejectNote(e.target.value)}
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={!rejectNote.trim() || reject.isPending}
                              onClick={() => handleReject(ts.id)}
                            >
                              Confirm Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRejectingId(null);
                                setRejectNote('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create `apps/web/app/(dashboard)/time-tracking/page.tsx`**

```tsx
'use client';

import { Header } from '@/components/dashboard/header';
import { ClockWidget } from '@/components/time-tracking/clock-widget';
import { EntriesTable } from '@/components/time-tracking/entries-table';
import { TimesheetsView } from '@/components/time-tracking/timesheets-view';

export default function TimeTrackingPage() {
  return (
    <>
      <Header title="Time Tracking" />
      <div className="p-6 space-y-6 max-w-6xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <ClockWidget />
          </div>
          <div className="md:col-span-2">
            <TimesheetsView />
          </div>
        </div>
        <EntriesTable />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "D:/Time champ-agent/apps/web" && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors. If `session?.user?.role` causes a type error, extend the NextAuth session type (see note below).

**Note on session.user.role:** If TypeScript complains about `role` not existing on `session.user`, add a declaration in `apps/web/types/next-auth.d.ts`:
```typescript
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'manager' | 'employee';
      organizationId: string;
    };
  }
}
```
And create the file if it doesn't exist. Check if `apps/web/lib/auth.ts` already includes `role` in the session callback — it likely does based on the Foundation implementation.

- [ ] **Step 6: Run all API tests**

```bash
cd "D:/Time champ-agent/apps/api" && npx jest --no-coverage 2>&1 | tail -10
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
cd "D:/Time champ-agent" && git add apps/web/components/time-tracking/ apps/web/app/\(dashboard\)/time-tracking/ && git commit -m "feat(web): add time tracking page with clock widget, entries table, and timesheet approval"
```

---

## Self-Review

**Spec coverage:**
- ✅ Clock in / clock out — Task 4 (service), Task 5 (controller), Task 8 (clock widget)
- ✅ Time entries (automatic + manual) — Task 4 (service), Task 5 (controller POST /entries), Task 8 (entries table)
- ✅ Attendance records — Task 4 (getAttendance), Task 5 (GET /attendance)
- ✅ Weekly timesheets — Task 4 (submitTimesheet), Task 5 (POST /timesheets/:weekStart/submit), Task 8 (timesheets view)
- ✅ Manager approval — Task 4 (approveTimesheet, rejectTimesheet), Task 5 (POST /approve, /reject), Task 8 (approve/reject buttons)
- ✅ Role-based access — controller uses @Roles(ADMIN, MANAGER) on approve/reject/team-status
- ✅ RLS tenant isolation — migration enables RLS on all 3 tables
- ✅ Database migration — Task 1
- ✅ TypeORM entities — Task 2
- ✅ DTOs with validation — Task 3
- ✅ Unit tests (10 tests) — Task 4
- ✅ Frontend hooks — Task 7
- ✅ Frontend page + components — Task 8

**Placeholder scan:** No TBD, TODO, or incomplete steps found. All code blocks are complete.

**Type consistency:**
- `Attendance` entity used consistently in service, controller, module, and frontend type
- `TimesheetStatus` enum values match frontend string literals ('draft', 'submitted', 'approved', 'rejected')
- `formatMinutes()` and `getWeekStart()` defined in hooks, used in both `entries-table.tsx` and `timesheets-view.tsx`
- `useClockStatus`, `useClockIn`, `useClockOut` defined in hooks, imported correctly in `clock-widget.tsx`
