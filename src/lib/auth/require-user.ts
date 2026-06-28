/**
 * `requireUser()` — server-side helper that resolves the currently
 * authenticated user.
 *
 * The app is being built with mock providers, so real NextAuth wiring
 * lands in a later story. For now we use a lightweight cookie-based
 * stub: any request that includes a `user-id` cookie with a positive
 * integer value is treated as authenticated as that user. This gives
 * us a single seam to swap for real auth without churning the call
 * sites in server actions and pages.
 *
 * Behavior:
 *   - Reads the `user-id` cookie via `next/headers`.
 *   - Throws `Error("Unauthorized ...")` if the cookie is missing,
 *     malformed, or refers to a non-existent user.
 *   - Returns `{ id, row }` where `row` is the snake_case user row
 *     (matching `SCHEMA_SQL` in `src/test/db.ts`).
 *
 * Test seam:
 *   - `__setCurrentUserIdForTests(id)` makes `requireUser()` ignore
 *     the cookie and return the user with that id. Call
 *     `__resetCurrentUserForTests()` in `afterEach` to clear.
 *   - This keeps unit tests free of `next/headers` cookie plumbing.
 */

import { cookies } from "next/headers";
import { getTestDb } from "@/test/db";

let __currentUserIdOverride: number | null = null;

/**
 * Test helper: force `requireUser()` to return the user with this id
 * regardless of cookies. Use in `beforeEach` / inside a test; remember
 * to call `__resetCurrentUserForTests()` in `afterEach`.
 */
export function __setCurrentUserIdForTests(id: number | null): void {
  __currentUserIdOverride = id;
}

/**
 * Test helper: drop the override so `requireUser()` goes back to
 * reading cookies.
 */
export function __resetCurrentUserForTests(): void {
  __currentUserIdOverride = null;
}

export interface RequireUserResult {
  /** The user's primary key. */
  id: number;
  /** The snake_case row from the DB (matches SCHEMA_SQL). */
  row: Record<string, unknown>;
}

/**
 * Resolve the current authenticated user, or throw.
 *
 * Throws on:
 *   - missing/invalid cookie (or unset test override)
 *   - user id not found in the DB
 */
export async function requireUser(): Promise<RequireUserResult> {
  let userId: number;

  if (__currentUserIdOverride !== null) {
    userId = __currentUserIdOverride;
  } else {
    const cookieStore = await cookies();
    const c = cookieStore.get("user-id");
    if (!c) {
      throw new Error("Unauthorized: missing user-id cookie");
    }
    const parsed = Number.parseInt(c.value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Unauthorized: invalid user-id cookie value: ${c.value}`,
      );
    }
    userId = parsed;
  }

  const db = getTestDb();
  const rows = await db.select("users", { id: userId });
  if (rows.length === 0) {
    throw new Error(`Unauthorized: user ${userId} not found`);
  }

  return { id: userId, row: rows[0]! };
}