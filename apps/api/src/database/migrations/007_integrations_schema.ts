import { MigrationInterface, QueryRunner } from 'typeorm';

export class IntegrationsSchema1743638400007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── webhook_endpoints ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,
        url             VARCHAR(500) NOT NULL,
        secret          VARCHAR(255),
        events          TEXT[] NOT NULL DEFAULT '{}',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org
        ON webhook_endpoints(organization_id);

      ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON webhook_endpoints
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── webhook_deliveries ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        endpoint_id   UUID REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
        event_type    VARCHAR(100) NOT NULL,
        payload       JSONB NOT NULL DEFAULT '{}',
        status_code   INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        succeeded     BOOLEAN NOT NULL DEFAULT FALSE,
        delivered_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
        ON webhook_deliveries(endpoint_id, created_at DESC);
    `);

    // ── slack_integrations ───────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS slack_integrations (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL UNIQUE,
        webhook_url     VARCHAR(500) NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_integrations_org
        ON slack_integrations(organization_id);

      ALTER TABLE slack_integrations ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON slack_integrations
        USING (organization_id::text = current_setting('app.current_org', true));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_deliveries`);
    await queryRunner.query(`DROP TABLE IF EXISTS webhook_endpoints`);
    await queryRunner.query(`DROP TABLE IF EXISTS slack_integrations`);
  }
}
