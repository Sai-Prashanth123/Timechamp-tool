import { MigrationInterface, QueryRunner } from 'typeorm';

export class StreamingSchema1743696000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS streaming_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS camera_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS audio_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS max_stream_fps INTEGER DEFAULT 1,
        ADD COLUMN IF NOT EXISTS daily_bandwidth_cap_mb INTEGER DEFAULT 500;
    `);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS stream_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        organization_id UUID NOT NULL,
        socket_id VARCHAR,
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP,
        bytes_rx BIGINT DEFAULT 0,
        bytes_tx BIGINT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        mode VARCHAR DEFAULT 'idle',
        disconnect_reason TEXT
      );
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_stream_sessions_user_started
        ON stream_sessions(user_id, started_at DESC);
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_stream_sessions_org_active
        ON stream_sessions(organization_id, is_active);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS stream_sessions;`);

    await qr.query(`
      ALTER TABLE organizations
        DROP COLUMN IF EXISTS streaming_enabled,
        DROP COLUMN IF EXISTS camera_enabled,
        DROP COLUMN IF EXISTS audio_enabled,
        DROP COLUMN IF EXISTS max_stream_fps,
        DROP COLUMN IF EXISTS daily_bandwidth_cap_mb;
    `);
  }
}
