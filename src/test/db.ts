import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

/**
 * PGlite-backed Drizzle DB factory for unit tests.
 *
 * The real production `db` (`src/db/index.ts`) is wired to a
 * postgres-js client against Neon / a hosted Postgres. We can't
 * use that in unit tests — it would either need a real database
 * connection or a per-test container. Instead we use PGlite, a
 * WASM build of Postgres, with the same schema.
 *
 * Each test gets a fresh in-memory database. The `dataDir` arg is
 * empty so the DB lives only in memory and is GC'd when the
 * reference drops. The schema is created with raw SQL that
 * mirrors the Drizzle schema, generated from `drizzle-kit push`
 * output. The SQL is checked in so the test doesn't depend on a
 * live `pnpm db:generate` step.
 *
 * Usage:
 *   const { db, client, close } = await createTestDb();
 *   await db.insert(users).values({ ... });
 *   close();
 */
export type TestDb = PgliteDatabase<typeof schema>;

export async function createTestDb(): Promise<{
  db: TestDb;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  await client.exec(SCHEMA_SQL);
  const db = drizzle(client, { schema });
  return {
    db,
    client,
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Raw SQL the test DB is initialized with. Kept in sync with the
 * Drizzle schema in `src/db/schema.ts` — any column / table
 * addition there needs a corresponding update here.
 *
 * Order matters: enum types must exist before the columns that
 * use them, and tables with foreign keys must be created after
 * the tables they reference.
 */
const SCHEMA_SQL = `
  -- Enums
  DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('user', 'admin');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE plan AS ENUM ('free', 'starter', 'pro');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE credit_reason AS ENUM ('purchase', 'send', 'refund', 'bonus', 'admin_adjust');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE sender_id_status AS ENUM ('pending', 'approved', 'rejected');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE message_status AS ENUM ('queued', 'scheduled', 'sending', 'sent', 'delivered', 'failed', 'received');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE recipient_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'received');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE scheduled_job_status AS ENUM ('pending', 'running', 'done', 'failed', 'cancelled');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  DO $$ BEGIN
    CREATE TYPE webhook_source AS ENUM ('stripe', 'twilio');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  -- Users
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'user',
    email_verified TIMESTAMPTZ,
    image TEXT,
    twilio_account_sid TEXT,
    twilio_auth_token TEXT,
    twilio_from_number TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

  -- Auth.js adapter tables (DrizzleAdapter-compatible names)
  CREATE TABLE IF NOT EXISTS authAccounts (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    session_state TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "authAccounts_provider_idx"
    ON authAccounts (provider, "providerAccountId");
  CREATE INDEX IF NOT EXISTS "authAccounts_user_id_idx"
    ON authAccounts (user_id);

  CREATE TABLE IF NOT EXISTS authVerificationTokens (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TIMESTAMPTZ NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS "authVerificationTokens_pk"
    ON authVerificationTokens (identifier, token);

  -- Accounts (billing)
  CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credits INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    plan plan NOT NULL DEFAULT 'free',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);

  -- Credit transactions
  CREATE TABLE IF NOT EXISTS credit_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason credit_reason NOT NULL,
    stripe_payment_intent_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS credit_transactions_user_id_idx ON credit_transactions (user_id);

  -- Sender IDs
  CREATE TABLE IF NOT EXISTS sender_ids (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    status sender_id_status NOT NULL DEFAULT 'pending',
    provider_sender_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sender_ids_user_value_idx ON sender_ids (user_id, value);

  -- Contact groups + contacts
  CREATE TABLE IF NOT EXISTS contact_groups (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS contact_groups_user_id_idx ON contact_groups (user_id);

  CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    group_id INTEGER REFERENCES contact_groups(id) ON DELETE SET NULL,
    opted_out BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_phone_idx ON contacts (user_id, phone);
  CREATE INDEX IF NOT EXISTS contacts_user_group_idx ON contacts (user_id, group_id);

  -- Messages + recipients
  CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    from_number TEXT NOT NULL,
    status message_status NOT NULL DEFAULT 'queued',
    twilio_message_sid TEXT,
    error_code TEXT,
    cost_credits INTEGER NOT NULL DEFAULT 0,
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS messages_user_id_idx ON messages (user_id);
  CREATE INDEX IF NOT EXISTS messages_status_idx ON messages (status);
  CREATE INDEX IF NOT EXISTS messages_scheduled_for_idx ON messages (scheduled_for);

  CREATE TABLE IF NOT EXISTS message_recipients (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    phone TEXT NOT NULL,
    status recipient_status NOT NULL DEFAULT 'pending',
    twilio_message_sid TEXT,
    error_code TEXT,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS message_recipients_message_id_idx ON message_recipients (message_id);
  CREATE INDEX IF NOT EXISTS message_recipients_phone_idx ON message_recipients (phone);

  -- Inbound messages
  CREATE TABLE IF NOT EXISTS inbound_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_phone TEXT NOT NULL,
    to_number TEXT NOT NULL,
    body TEXT NOT NULL,
    twilio_message_sid TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS inbound_messages_twilio_sid_idx ON inbound_messages (twilio_message_sid);
  CREATE INDEX IF NOT EXISTS inbound_messages_user_id_idx ON inbound_messages (user_id);
  CREATE INDEX IF NOT EXISTS inbound_messages_user_read_idx ON inbound_messages (user_id, read);

  -- Scheduled jobs
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    run_at TIMESTAMPTZ NOT NULL,
    status scheduled_job_status NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS scheduled_jobs_run_at_idx ON scheduled_jobs (run_at, status);
  CREATE INDEX IF NOT EXISTS scheduled_jobs_user_id_idx ON scheduled_jobs (user_id);

  -- Webhook events
  CREATE TABLE IF NOT EXISTS webhook_events (
    id SERIAL PRIMARY KEY,
    source webhook_source NOT NULL,
    event_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_source_event_idx ON webhook_events (source, event_id);
`;
