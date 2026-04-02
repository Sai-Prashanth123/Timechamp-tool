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
