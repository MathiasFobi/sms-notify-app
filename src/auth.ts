import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  accounts,
  authAccounts,
  authVerificationTokens,
  users,
} from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { authConfig } from "@/auth.config";

/**
 * Server-side NextAuth v5 setup.
 *
 * - DrizzleAdapter wires Auth.js to our Drizzle schema. We pass the
 *   full schema object so the adapter can find the OAuth tables
 *   (`authAccounts`, `authVerificationTokens`) automatically.
 *   The `usersTable`/`accountsTable` overrides point the adapter
 *   at our billing `accounts` table for the OAuth link records
 *   (otherwise it would collide with the name).
 * - JWT session strategy. The DrizzleAdapter is still attached so
 *   user records are normalized in the DB; the actual session
 *   token is a signed JWT in an HTTP-only cookie. This keeps the
 *   v1 hot path stateless and saves a DB roundtrip per request.
 * - The credentials provider's `authorize` callback is the only
 *   place that does password verification.
 *
 * The `auth`, `signIn`, `signOut`, and `requireUser` exports are
 * the canonical entry points for server code (route handlers,
 * server actions, server components).
 *
 * Layering:
 *   src/auth.config.ts — edge-safe config (no DB, no bcrypt)
 *   src/middleware.ts  — uses auth.config.ts (Edge runtime)
 *   src/auth.ts        — this file (Node runtime)
 *   src/lib/auth.ts    — re-exports + the requireUser() helper
 */

const credentialsSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export const {
  handlers,
  auth,
  signIn,
  signOut,
  unstable_update: update,
} = NextAuth({
  ...authConfig,
  // DrizzleAdapter's typing is generous — it accepts any pgTable
  // for `usersTable`/`accountsTable`. We pass our schema so it can
  // discover `authAccounts` and `authVerificationTokens`
  // automatically.
  //
  // The `as never` casts work around a strictness mismatch: the
  // adapter's `DefaultPostgresUsersTable` type wants the primary
  // key column to be `text`/`uuid`, but we use `serial` everywhere
  // for simplicity. In v1 the adapter is only here so user records
  // are normalized (the spec calls this out); session storage is
  // JWT, not DB-backed, so the adapter's row shapes never get
  // queried for an OAuth link. Cast is safe.
  adapter: DrizzleAdapter(db, {
    usersTable: users as never,
    accountsTable: authAccounts as never,
    verificationTokensTable: authVerificationTokens as never,
  }),
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(rawCredentials) {
        // Defensive parse — the schema rejects malformed input
        // before we hit the DB. We never trust the wire format.
        const parsed = credentialsSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const [row] = await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        // Always run verifyPassword even when the user is missing,
        // so a timing-side-channel can't tell the difference between
        // "no such user" and "wrong password".
        const hash = row?.passwordHash ?? "$2b$10$invalidsaltinvalidsaltinvO9HZAEqMabc";
        const ok = await verifyPassword(password, hash);
        if (!row || !ok) return null;

        // Pull the account id (for downstream billing queries).
        const [acct] = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.userId, row.id))
          .limit(1);

        return {
          id: String(row.id),
          email: row.email,
          name: row.name,
          role: row.role,
          // Stash the account id in a non-standard field; the
          // `jwt` callback in auth.config.ts pulls it out via
          // the generic `user` shape.
          accountId: acct?.id,
        };
      },
    }),
  ],
});
