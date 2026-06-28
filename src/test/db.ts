/**
 * Test database factory + raw SQL schema.
 *
 * Two pieces in this file:
 *
 * 1. `SCHEMA_SQL` — raw `CREATE TABLE` (and enum) DDL that mirrors every
 *    table in `src/db/schema.ts`. This is the contract for tests that use
 *    a real Postgres-flavored in-memory engine (e.g. PGlite) — the SQL
 *    can be applied at test boot and torn down at the end. Keeping the
 *    raw DDL here means tests don't need to round-trip through drizzle-kit
 *    or pull in the live `db` client.
 *
 * 2. `createTestDb()` — a tiny in-memory shim that supports just the
 *    operations the mock billing provider needs (`insert`, `update`,
 *    `select where equal`). Use this for unit tests of the billing layer
 *    that must verify DB persistence without the overhead of PGlite or a
 *    real Postgres. When PGlite is wired into the test runner later, swap
 *    this for the real engine; the `SCHEMA_SQL` constant is the bridge.
 *
 * NOTE: This file is only imported from `*.test.ts` and dev tooling — it
 * must NEVER be bundled into production code.
 */

import { randomUUID } from "node:crypto";

// ============================================================================
// Raw DDL — keep in sync with src/db/schema.ts
// ============================================================================

/**
 * Raw `CREATE TYPE` + `CREATE TABLE` DDL for every table in the schema.
 *
 * Apply with `await db.exec(SCHEMA_SQL)` (or the PGlite equivalent) at
 * test boot. Column types and constraints mirror the drizzle definitions
 * one-for-one so a query that works against the live DB behaves the
 * same against a freshly-bootstrapped test DB.
 */
export const SCHEMA_SQL = `
-- Enums
CREATE TYPE "public"."checkout_session_status" AS ENUM('pending', 'completed', 'cancelled');
CREATE TYPE "public"."credit_reason" AS ENUM('purchase', 'send', 'refund', 'bonus', 'admin_adjust');
CREATE TYPE "public"."message_status" AS ENUM('queued', 'scheduled', 'sending', 'sent', 'delivered', 'failed', 'received');
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'pro');
CREATE TYPE "public"."recipient_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'received');
CREATE TYPE "public"."scheduled_job_status" AS ENUM('pending', 'running', 'done', 'failed', 'cancelled');
CREATE TYPE "public"."sender_id_status" AS ENUM('pending', 'approved', 'rejected');
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');
CREATE TYPE "public"."webhook_source" AS ENUM('stripe', 'twilio');

-- Users
CREATE TABLE "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "name" text NOT NULL,
  "role" "user_role" DEFAULT 'user' NOT NULL,
  "twilio_account_sid" text,
  "twilio_auth_token" text,
  "twilio_from_number" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "accounts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credits" integer DEFAULT 0 NOT NULL,
  "stripe_customer_id" text,
  "plan" "plan" DEFAULT 'free' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "credit_transactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "delta" integer NOT NULL,
  "reason" "credit_reason" NOT NULL,
  "stripe_payment_intent_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sender_ids" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "value" text NOT NULL,
  "status" "sender_id_status" DEFAULT 'pending' NOT NULL,
  "provider_sender_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contact_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "phone" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "group_id" serial REFERENCES "contact_groups"("id") ON DELETE SET NULL,
  "opted_out" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "body" text NOT NULL,
  "from_number" text NOT NULL,
  "status" "message_status" DEFAULT 'queued' NOT NULL,
  "twilio_message_sid" text,
  "error_code" text,
  "cost_credits" integer DEFAULT 0 NOT NULL,
  "scheduled_for" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "message_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" serial NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "contact_id" serial REFERENCES "contacts"("id") ON DELETE SET NULL,
  "phone" text NOT NULL,
  "status" "recipient_status" DEFAULT 'pending' NOT NULL,
  "twilio_message_sid" text,
  "error_code" text,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone
);

CREATE TABLE "inbound_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "from_phone" text NOT NULL,
  "to_number" text NOT NULL,
  "body" text NOT NULL,
  "twilio_message_sid" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "scheduled_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "message_id" serial NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
  "run_at" timestamp with time zone NOT NULL,
  "status" "scheduled_job_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text
);

CREATE TABLE "webhook_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "source" "webhook_source" NOT NULL,
  "event_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "checkout_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" serial NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "stripe_session_id" text NOT NULL,
  "package_credits" integer NOT NULL,
  "price_usd_cents" integer NOT NULL,
  "status" "checkout_session_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
`;

// ============================================================================
// Test DB singleton
// ============================================================================

/**
 * Process-wide singleton `TestDb`. Tests use this so the
 * `MockStripeProvider` (which holds no DB of its own) can be a true
 * module-level singleton via `getBillingProvider()`.
 *
 * Tests should call `__resetTestDbForTests()` in `beforeEach` to get
 * a fresh empty DB. Production code NEVER imports this — it's only
 * used to back the mock billing provider's persistence.
 */
let cachedTestDb: TestDb | null = null;

export function getTestDb(): TestDb {
  if (cachedTestDb) return cachedTestDb;
  cachedTestDb = createTestDb();
  return cachedTestDb;
}

/**
 * Test helper: discard the cached TestDb so the next `getTestDb()` call
 * returns a fresh, empty database. Use in `beforeEach` for isolation.
 */
export function __resetTestDbForTests(): void {
  cachedTestDb = null;
}

/**
 * Test helper: drop all rows from every table without discarding the
 * TestDb object itself. Useful when you want to keep the singleton
 * (and any providers constructed against it) but start the next test
 * with empty tables.
 */
export function __truncateTestDbForTests(): void {
  if (cachedTestDb) cachedTestDb.reset();
}

// ============================================================================
// In-memory DB shim — just enough surface for the mock billing provider test.
// ============================================================================

/**
 * Minimal row shape accepted by the in-memory DB.
 * Keys must match the column names in `SCHEMA_SQL` (snake_case).
 */
export type TestRow = Record<string, unknown>;

/**
 * Minimal table shape. The full schema lives in `src/db/schema.ts`; this
 * is a typed handle on one table's in-memory contents.
 */
export interface TestTable {
  /** All rows currently in the table, in insertion order. */
  rows: TestRow[];
  /** Auto-increment counter; bumped on every insert. */
  nextId: number;
}

export interface TestDb {
  /** Per-table in-memory store keyed by table name. */
  tables: Record<string, TestTable>;
  /**
   * Insert a row into the named table. Assigns an `id` and a `created_at`
   * if not provided. Returns the inserted row (with the assigned values).
   */
  insert(tableName: string, row: TestRow): Promise<TestRow>;
  /**
   * Update rows in `tableName` where every key in `where` equals the
   * stored row's value. Sets `updated_at` / `completed_at` automatically
   * for the corresponding columns when those keys are in `set`.
   * Returns the number of rows touched.
   */
  update(
    tableName: string,
    where: Record<string, unknown>,
    set: Record<string, unknown>,
  ): Promise<number>;
  /** Return all rows in `tableName` matching `where` (every key equal). */
  select(
    tableName: string,
    where?: Record<string, unknown>,
  ): Promise<TestRow[]>;
  /** Drop all rows from every table. Useful in `beforeEach`. */
  reset(): void;
}

/**
 * Create a fresh in-memory DB seeded with empty tables for every table
 * defined in `SCHEMA_SQL`. Tables not explicitly populated can still
 * receive inserts; they just start empty.
 *
 * Each call returns a NEW DB so tests get isolation for free — no need
 * to reset between tests if you create a new DB in `beforeEach`.
 */
export function createTestDb(): TestDb {
  const TABLE_NAMES = [
    "users",
    "accounts",
    "credit_transactions",
    "sender_ids",
    "contact_groups",
    "contacts",
    "messages",
    "message_recipients",
    "inbound_messages",
    "scheduled_jobs",
    "webhook_events",
    "checkout_sessions",
  ];

  const tables: Record<string, TestTable> = {};
  for (const name of TABLE_NAMES) {
    tables[name] = { rows: [], nextId: 1 };
  }

  function matchRow(row: TestRow, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (row[k] !== v) return false;
    }
    return true;
  }

  return {
    tables,

    async insert(tableName: string, row: TestRow): Promise<TestRow> {
      const table = tables[tableName];
      if (!table) {
        throw new Error(`createTestDb: unknown table "${tableName}"`);
      }
      const id = row.id ?? table.nextId++;
      const now = new Date();
      const inserted: TestRow = { ...row, id };
      // Default created_at for tables that have it. We set it here rather
      // than relying on Postgres `DEFAULT now()` so the in-memory shim
      // matches production behavior for inserts that don't supply it.
      if (inserted.created_at === undefined) {
        inserted.created_at = now;
      }
      table.rows.push(inserted);
      return inserted;
    },

    async update(
      tableName: string,
      where: Record<string, unknown>,
      set: Record<string, unknown>,
    ): Promise<number> {
      const table = tables[tableName];
      if (!table) {
        throw new Error(`createTestDb: unknown table "${tableName}"`);
      }
      let touched = 0;
      for (const row of table.rows) {
        if (!matchRow(row, where)) continue;
        for (const [k, v] of Object.entries(set)) {
          row[k] = v;
        }
        if (tableName === "accounts" && set.updated_at === undefined) {
          row.updated_at = new Date();
        }
        touched++;
      }
      return touched;
    },

    async select(
      tableName: string,
      where?: Record<string, unknown>,
    ): Promise<TestRow[]> {
      const table = tables[tableName];
      if (!table) {
        throw new Error(`createTestDb: unknown table "${tableName}"`);
      }
      if (!where) return [...table.rows];
      return table.rows.filter((r) => matchRow(r, where));
    },

    reset(): void {
      for (const name of TABLE_NAMES) {
        tables[name].rows = [];
        tables[name].nextId = 1;
      }
    },
  };
}

// Re-export for tests that want a stable id generator.
export { randomUUID };

/**
 * Resolve the snake_case table name from a Drizzle `pgTable` handle.
 *
 * In drizzle-orm v0.45 the table name is stored on a `Symbol(drizzle:Name)`
 * symbol rather than as a plain property. This helper centralizes the
 * lookup so test code doesn't sprinkle the symbol-lookup pattern around.
 */
export function getTableName(
  table: unknown,
): string {
  const nameSym = Object.getOwnPropertySymbols(table as object).find(
    (s) => s.toString() === "Symbol(drizzle:Name)",
  );
  if (!nameSym) {
    throw new Error(
      "getTableName: passed value does not look like a Drizzle pgTable " +
        "(no Symbol(drizzle:Name) found).",
    );
  }
  const name = (table as Record<symbol, unknown>)[nameSym];
  if (typeof name !== "string") {
    throw new Error(`getTableName: unexpected non-string name: ${String(name)}`);
  }
  return name;
}