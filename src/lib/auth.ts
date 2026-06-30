/**
 * Auth helpers for server actions and server components.
 *
 * Re-exports `requireUser()` (the cookie-based stub for the
 * `/app/*` routes) and `requireAdmin()` (the gate for the `/admin/*`
 * routes) from their implementations under `./auth/`.
 *
 * Real NextAuth wiring will land in a later story; for now both
 * helpers use the lightweight `__setCurrentUserIdForTests()` test
 * override + `user-id` cookie seam.
 *
 * Note: this file deliberately exists at `src/lib/auth.ts` (the
 * single flat module path the user-story spec calls out), and also
 * as a folder at `src/lib/auth/` (which holds the actual
 * implementations). The `index.ts` re-exports keep both paths
 * working for downstream importers.
 */

export {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
  requireUser,
  type RequireUserResult,
} from "./auth/require-user";
export { requireAdmin } from "./auth/require-admin";