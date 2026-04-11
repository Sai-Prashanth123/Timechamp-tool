import { MigrationInterface, QueryRunner } from 'typeorm';

export class KeystrokesTelemetry1712620800000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS keystroke_events (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id          UUID NOT NULL,
        organization_id  UUID NOT NULL,
        keys_per_min     INTEGER NOT NULL DEFAULT 0,
        mouse_per_min    INTEGER NOT NULL DEFAULT 0,
        recorded_at      TIMESTAMPTZ NOT NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_keystroke_events_org_time
        ON keystroke_events(organization_id, recorded_at DESC);
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_keystroke_events_user_time
        ON keystroke_events(user_id, recorded_at DESC);
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS agent_telemetry (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID NOT NULL,
        organization_id       UUID NOT NULL,
        agent_version         VARCHAR(32) NOT NULL,
        os                    VARCHAR(32) NOT NULL,
        uptime_sec            BIGINT NOT NULL DEFAULT 0,
        mem_used_mb           FLOAT NOT NULL DEFAULT 0,
        cpu_percent           FLOAT NOT NULL DEFAULT 0,
        last_sync_success     BOOLEAN NOT NULL DEFAULT FALSE,
        last_sync_latency_ms  INTEGER NOT NULL DEFAULT 0,
        buffered_events       INTEGER NOT NULL DEFAULT 0,
        sync_error_count      INTEGER NOT NULL DEFAULT 0,
        has_screen_recording  BOOLEAN NOT NULL DEFAULT FALSE,
        has_accessibility     BOOLEAN NOT NULL DEFAULT FALSE,
        url_detection_layer   INTEGER NOT NULL DEFAULT 0,
        recorded_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_telemetry_org_time
        ON agent_telemetry(organization_id, recorded_at DESC);
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_telemetry_user_time
        ON agent_telemetry(user_id, recorded_at DESC);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS agent_telemetry`);
    await qr.query(`DROP TABLE IF EXISTS keystroke_events`);
  }
}
