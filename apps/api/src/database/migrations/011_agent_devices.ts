import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentDevices1743782400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS agent_devices (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token    VARCHAR(255) UNIQUE NOT NULL,
        hostname        VARCHAR(255),
        platform        VARCHAR(50),
        agent_version   VARCHAR(50),
        last_seen_at    TIMESTAMPTZ,
        is_active       BOOLEAN NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_token  ON agent_devices(device_token);`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_user   ON agent_devices(user_id);`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_agent_devices_org    ON agent_devices(organization_id);`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS agent_devices;`);
  }
}
