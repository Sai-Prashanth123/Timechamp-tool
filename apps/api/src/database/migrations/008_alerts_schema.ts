import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlertsSchema1000000008 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE alert_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,
        name VARCHAR(255) NOT NULL,
        metric VARCHAR(100) NOT NULL,
        threshold_minutes INT NOT NULL DEFAULT 30,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_alert_rules_org ON alert_rules(organization_id);
      ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON alert_rules
        USING (organization_id::text = current_setting('app.current_org', true));

      CREATE TABLE alert_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,
        rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
        user_id UUID NOT NULL,
        metric VARCHAR(100) NOT NULL,
        value_minutes INT NOT NULL,
        threshold_minutes INT NOT NULL,
        triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX idx_alert_events_org ON alert_events(organization_id);
      CREATE INDEX idx_alert_events_triggered ON alert_events(triggered_at DESC);
      ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON alert_events
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS alert_events;
      DROP TABLE IF EXISTS alert_rules;
    `);
  }
}
