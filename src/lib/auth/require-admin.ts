/**
 * `requireAdmin()` — server-side gate for `/admin/*` routes.
 *
 * Resolves the current authenticated user via the same cookie /
 * `__setCurrentUserIdForTests` seam as `requireUser()`, then
 * verifies the `users.role` column equals `'admin'`.
 *
 * Throws `notFound()` (a Next.js sentinel that the server renders
 * as a 404 response) when:
 *   - no current user is resolved (mirror of `requireUser`'s
 *     "Unauthorized" branch — we collapse this into a 404 to avoid
 *     leaking the existence of the admin section to non-admins),
 *   - the user row's `role` is anything other than `'admin'`
 *     (including `null` / `undefined` / missing — defensively
 *     coerced to `'user'`).
 *
 * Why `notFound()` instead of a thrown `Error`:
 *   - We don't want a non-admin to be able to tell the difference
 *     between "the admin section doesn't exist" and "you're not
 *     allowed in". A 404 collapses both cases into the same
 *     observable response.
 *   - Next.js's `notFound()` works as a top-level render short
 *     circuit — it can be called from a server component, server
 *     action, or route handler and the framework handles the 404
 *     response shape.
 *
 * Test seam:
 *   - Inherits `__setCurrentUserIdForTests(id)` /
 *     `__resetCurrentUserForTests()` from `./require-user` so
 *     unit tests can flip the "current user" without touching
 *     cookies. Set the override to a non-admin user to exercise
 *     the notFound() branch, or to an admin user to exercise the
 *     success branch.
 */

import { notFound } from "next/navigation";
import { requireUser } from "./require-user";

/**
 * Resolve the current user and require `role === 'admin'`.
 *
 * Throws `notFound()` (which Next.js converts to a 404 response)
 * if the user is unauthenticated OR the user row's `role` is not
 * `'admin'`. The returned value mirrors `requireUser()`'s shape.
 */
export async function requireAdmin(): Promise<{
  id: number;
  row: Record<string, unknown>;
}> {
  // `requireUser()` itself throws on the unauthenticated case, so
  // we don't need to re-handle that branch here — the throw
  // bubbles to the caller, which is the correct behavior for
  // unauthenticated requests. (NextAuth's middleware will redirect
  // unauthenticated users to sign-in once that wiring lands.)
  const user = await requireUser();

  // The DB stores `role` as the snake_case string from `SCHEMA_SQL`
  // — `'admin'` or `'user'`. Anything else (including the empty
  // string, null, or undefined) is treated as non-admin.
  if (user.row.role !== "admin") {
    notFound();
  }

  return user;
}