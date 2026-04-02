import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectsSchema1712200000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── projects ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL,
        name            VARCHAR(255) NOT NULL,
        description     TEXT,
        status          VARCHAR(50) NOT NULL DEFAULT 'active',
        deadline        TIMESTAMPTZ,
        created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_projects_org        ON projects(organization_id);
      CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);

      ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON projects
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── tasks ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        organization_id  UUID NOT NULL,
        assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        title            VARCHAR(255) NOT NULL,
        description      TEXT,
        status           VARCHAR(50) NOT NULL DEFAULT 'todo',
        priority         VARCHAR(50) NOT NULL DEFAULT 'medium',
        estimated_hours  DECIMAL(6,2),
        due_date         TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_project     ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_org         ON tasks(organization_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee    ON tasks(assignee_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(project_id, status);

      ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON tasks
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── milestones ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS milestones (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        name            VARCHAR(255) NOT NULL,
        due_date        TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
      CREATE INDEX IF NOT EXISTS idx_milestones_org     ON milestones(organization_id);

      ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON milestones
        USING (organization_id::text = current_setting('app.current_org', true));
    `);

    // ── time_entries: add optional project_id + task_id columns ─────────
    await queryRunner.query(`
      ALTER TABLE time_entries
        ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS task_id    UUID REFERENCES tasks(id)    ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_time_entries_task    ON time_entries(task_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE time_entries
        DROP COLUMN IF EXISTS task_id,
        DROP COLUMN IF EXISTS project_id;
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS milestones CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS tasks CASCADE;`);
    await queryRunner.query(`DROP TABLE IF EXISTS projects CASCADE;`);
  }
}
