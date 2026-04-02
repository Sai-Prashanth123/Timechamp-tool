import { MigrationInterface, QueryRunner } from 'typeorm';

export class MonitoringSchema1712200000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add agent_token to users — UUID each employee uses to authenticate the desktop agent
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_token UUID DEFAULT uuid_generate_v4();
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_agent_token ON users(agent_token) WHERE agent_token IS NOT NULL;
    `);

    // activity_events — app/window usage records sent by the Go agent
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        app_name        VARCHAR(255) NOT NULL,
        window_title    VARCHAR(500),
        started_at      TIMESTAMPTZ NOT NULL,
        duration_sec    INTEGER NOT NULL DEFAULT 0,
        keystroke_count INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_activity_events_user_org    ON activity_events(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_activity_events_started_at  ON activity_events(started_at DESC);

      ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON activity_events
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // screenshots — metadata only; actual image lives in S3
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        s3_key          VARCHAR(500) NOT NULL,
        captured_at     TIMESTAMPTZ NOT NULL,
        file_size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_screenshots_user_org    ON screenshots(user_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at ON screenshots(captured_at DESC);

      ALTER TABLE screenshots ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON screenshots
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS screenshots`);
    await queryRunner.query(`DROP TABLE IF EXISTS activity_events`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS agent_token`);
  }
}
