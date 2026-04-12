import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds per-device scoping to the two hot monitoring tables. Today both
 * rely on `user_id` which means two machines owned by the same user
 * merge their activity/screenshot streams on the live dashboard — the
 * user can't tell which app is running on which laptop.
 *
 * Nullable, no FK constraint: legacy rows written before this migration
 * stay `device_id IS NULL`. The read queries in monitoring.service.ts
 * gracefully handle nulls (returning an empty currentApp while the first
 * post-deploy sync lands a row with a populated device_id).
 *
 * Indexes are composite `(device_id, timestamp DESC)` to match the
 * access pattern `WHERE device_id = $1 ORDER BY <ts> DESC LIMIT 1` used
 * by getLiveStatus / getScreenshots.
 */
export class DeviceIdActivityScreenshots1744416000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE activity_events
        ADD COLUMN IF NOT EXISTS device_id UUID;
    `);
    await qr.query(`
      ALTER TABLE screenshots
        ADD COLUMN IF NOT EXISTS device_id UUID;
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_activity_events_device_started
        ON activity_events(device_id, started_at DESC);
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_screenshots_device_captured
        ON screenshots(device_id, captured_at DESC);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_screenshots_device_captured;`);
    await qr.query(`DROP INDEX IF EXISTS idx_activity_events_device_started;`);
    await qr.query(`ALTER TABLE screenshots     DROP COLUMN IF EXISTS device_id;`);
    await qr.query(`ALTER TABLE activity_events DROP COLUMN IF EXISTS device_id;`);
  }
}
