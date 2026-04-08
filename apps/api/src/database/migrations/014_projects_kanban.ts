import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectsKanban1744070400014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── projects: add color column ──────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE projects
        ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#3B82F6';
    `);

    // ── tasks: add position + created_by columns ────────────────────────
    await queryRunner.query(`
      ALTER TABLE tasks
        ADD COLUMN IF NOT EXISTS position    INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(project_id, status, position);
    `);

    // ── task_comments ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS task_comments;`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tasks_position;`);
    await queryRunner.query(`
      ALTER TABLE tasks
        DROP COLUMN IF EXISTS position,
        DROP COLUMN IF EXISTS created_by;
    `);
    await queryRunner.query(`
      ALTER TABLE projects
        DROP COLUMN IF EXISTS color;
    `);
  }
}
