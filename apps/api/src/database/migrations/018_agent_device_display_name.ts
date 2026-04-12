import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a per-device human label so the admin dashboard can show
 * "Sai's Laptop" instead of a machine hostname. The agent setup UI
 * asks the user for this name at registration time and persists it
 * here; older agents that don't send the field fall back to hostname.
 *
 * Backfill: existing rows are seeded with their hostname so the
 * dashboard has something to render immediately after deploy.
 */
export class AgentDeviceDisplayName1744329600000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE agent_devices
        ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
    `);
    await qr.query(`
      UPDATE agent_devices
         SET display_name = hostname
       WHERE display_name IS NULL;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE agent_devices DROP COLUMN IF EXISTS display_name;`);
  }
}
