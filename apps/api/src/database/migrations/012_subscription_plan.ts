import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionPlan1743868800000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE subscriptions
        ADD COLUMN IF NOT EXISTS plan VARCHAR(50) DEFAULT 'starter';
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS plan;`);
  }
}
