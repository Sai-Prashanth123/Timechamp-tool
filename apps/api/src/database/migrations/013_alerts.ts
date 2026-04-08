import { MigrationInterface, QueryRunner } from 'typeorm';

export class Alerts1743955200000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        threshold INTEGER NOT NULL DEFAULT 30,
        enabled BOOLEAN NOT NULL DEFAULT true,
        notify_email BOOLEAN NOT NULL DEFAULT true,
        notify_in_app BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(organization_id);

      CREATE TABLE IF NOT EXISTS alert_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        seen_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_alert_events_org ON alert_events(organization_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_alert_events_user ON alert_events(user_id, created_at DESC);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS alert_events; DROP TABLE IF EXISTS alert_rules;`);
  }
}
