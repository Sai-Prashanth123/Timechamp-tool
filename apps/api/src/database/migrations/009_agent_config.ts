import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentConfig1743609600000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE organizations
        ADD COLUMN IF NOT EXISTS screenshot_interval_sec INTEGER NOT NULL DEFAULT 300;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE organizations
        DROP COLUMN IF EXISTS screenshot_interval_sec;
    `);
  }
}
