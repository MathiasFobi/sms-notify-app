import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Schema is the single source of truth for the DB. Migrations are generated
 * to ./drizzle/ and applied with `pnpm db:migrate`. For local prototyping
 * use `pnpm db:push` to sync schema directly (skip migration files).
 *
 * The connection URL is read from $DATABASE_URL at runtime — never inline
 * credentials in this file.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
