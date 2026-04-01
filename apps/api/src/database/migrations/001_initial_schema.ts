import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // Organizations
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE org_plan AS ENUM ('starter', 'pro', 'enterprise');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        plan org_plan NOT NULL DEFAULT 'starter',
        seats INTEGER NOT NULL DEFAULT 5,
        logo_url VARCHAR(500),
        website VARCHAR(500),
        timezone VARCHAR(100) DEFAULT 'UTC',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Users
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        role user_role NOT NULL DEFAULT 'employee',
        avatar_url VARCHAR(500),
        email_verified BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        invited_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id, email)
      );
      CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(organization_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    // Subscriptions
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;

      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        stripe_price_id VARCHAR(255),
        status subscription_status NOT NULL DEFAULT 'trialing',
        seats INTEGER NOT NULL DEFAULT 5,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        canceled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Refresh tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id UUID NOT NULL,
        token VARCHAR(500) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked BOOLEAN NOT NULL DEFAULT false,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);

    // Row Level Security
    await queryRunner.query(`
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation ON users;
      CREATE POLICY tenant_isolation ON users
        USING (organization_id::text = current_setting('app.current_org', true));

      DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
      CREATE POLICY tenant_isolation ON subscriptions
        USING (organization_id::text = current_setting('app.current_org', true));

      DROP POLICY IF EXISTS tenant_isolation ON refresh_tokens;
      CREATE POLICY tenant_isolation ON refresh_tokens
        USING (organization_id::text = current_setting('app.current_org', true));

      ALTER TABLE users FORCE ROW LEVEL SECURITY;
      ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
      ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS subscriptions CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS users CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS organizations CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS subscription_status`);
    await queryRunner.query(`DROP TYPE IF EXISTS user_role`);
    await queryRunner.query(`DROP TYPE IF EXISTS org_plan`);
  }
}
