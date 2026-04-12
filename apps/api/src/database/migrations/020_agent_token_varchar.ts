import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens `users.agent_token` from `uuid` to `varchar(80)` so the token
 * can carry a human-readable username prefix (e.g. `saiprashanth-<hex>`)
 * in addition to the random component. The prefix makes a copied token
 * visually identifiable at a glance and helps with multi-workspace
 * handling — there's nothing in the old format that tells you whose
 * token you're looking at.
 *
 * The `USING agent_token::text` cast converts existing UUID values to
 * their canonical string form (`xxxxxxxx-xxxx-...`) which still matches
 * any lookup equality check. No data rewrite needed; old bare-UUID rows
 * keep working until the user rotates them (manually or via the auto-
 * rotate on next successful agent registration).
 *
 * The unique constraint migrates across the type change automatically
 * because it's a pure ALTER COLUMN TYPE.
 *
 * Length 80 is a comfortable ceiling: the new generator produces at most
 * 57 chars (24 slug + 1 dash + 32 hex). 80 leaves headroom for future
 * format tweaks without another migration.
 */
export class AgentTokenVarchar1744502400000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE users
        ALTER COLUMN agent_token TYPE varchar(80)
        USING agent_token::text;
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE users
        ALTER COLUMN agent_token TYPE uuid
        USING agent_token::uuid;
    `);
  }
}
