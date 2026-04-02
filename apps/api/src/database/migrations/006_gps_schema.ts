import { MigrationInterface, QueryRunner } from 'typeorm';

export class GpsSchema1712200000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── gps_locations ─────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS gps_locations (
        id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID        NOT NULL,
        lat             DECIMAL(10,8) NOT NULL,
        lng             DECIMAL(11,8) NOT NULL,
        accuracy        DECIMAL(8,2),
        battery_level   INTEGER,
        recorded_at     TIMESTAMPTZ NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_gps_locations_user_org
        ON gps_locations(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_gps_locations_recorded_at
        ON gps_locations(recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_gps_locations_org_recorded
        ON gps_locations(organization_id, recorded_at DESC);

      ALTER TABLE gps_locations ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON gps_locations
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── geofences ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS geofences (
        id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID        NOT NULL,
        name            VARCHAR(255) NOT NULL,
        lat             DECIMAL(10,8) NOT NULL,
        lng             DECIMAL(11,8) NOT NULL,
        radius_meters   INTEGER     NOT NULL DEFAULT 100,
        auto_clock_in   BOOLEAN     NOT NULL DEFAULT FALSE,
        auto_clock_out  BOOLEAN     NOT NULL DEFAULT FALSE,
        is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_geofences_org
        ON geofences(organization_id);
      CREATE INDEX IF NOT EXISTS idx_geofences_org_active
        ON geofences(organization_id, is_active);

      ALTER TABLE geofences ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON geofences
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS gps_locations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS geofences;`);
  }
}
