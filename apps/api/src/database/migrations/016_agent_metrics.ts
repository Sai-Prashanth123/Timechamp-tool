import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentMetrics1712534400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS agent_metrics (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   VARCHAR NOT NULL,
        org_id        VARCHAR NOT NULL,
        cpu_percent   FLOAT NOT NULL DEFAULT 0,
        mem_used_mb   BIGINT NOT NULL DEFAULT 0,
        mem_total_mb  BIGINT NOT NULL DEFAULT 0,
        agent_cpu_percent FLOAT NOT NULL DEFAULT 0,
        agent_mem_mb  BIGINT NOT NULL DEFAULT 0,
        recorded_at   TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_metrics_org_time
        ON agent_metrics(org_id, recorded_at DESC);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS agent_metrics`);
  }
}
