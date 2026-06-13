import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Singleton Postgres client + Drizzle ORM handle.
 *
 * - The postgres-js client is created once per Node process and reused
 *   (postgres-js internally pools connections).
 * - We pass `prepare: false` when running on Vercel/Neon because Neon's
 *   HTTP-based pooler doesn't support prepared statements. For a direct
 *   Postgres connection you can drop the flag.
 * - In dev, Next.js HMR can re-import this module many times. We stash
 *   the client on `globalThis` to avoid leaking connections.
 */
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

const pgClient =
  globalForDb.pgClient ??
  postgres(env.DATABASE_URL, {
    prepare: false,
    max: 10,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.pgClient = pgClient;
}

export const db = drizzle(pgClient, { schema });

export type Database = typeof db;
