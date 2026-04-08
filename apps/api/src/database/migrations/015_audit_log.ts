import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLog1744070400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL,
        actor_id        UUID,
        actor_email     VARCHAR(255) NOT NULL,
        action          VARCHAR(100) NOT NULL,
        resource_type   VARCHAR(50)  NOT NULL,
        resource_id     VARCHAR(255),
        metadata        JSONB,
        ip_address      VARCHAR(45),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
        ON audit_log (organization_id, created_at DESC);
    `);

    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor
        ON audit_log (actor_id);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP INDEX IF EXISTS idx_audit_log_actor;`);
    await qr.query(`DROP INDEX IF EXISTS idx_audit_log_org_created;`);
    await qr.query(`DROP TABLE IF EXISTS audit_log;`);
  }
}
