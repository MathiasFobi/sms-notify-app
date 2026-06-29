/**
 * Auth helpers.
 *
 * Real NextAuth wiring will land in a later story; for now this module
 * exposes a single `requireUser()` cookie-based stub used by server
 * actions and server components under `/app`.
 */

export {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
  requireUser,
  type RequireUserResult,
} from "./require-user";
export { requireAdmin } from "./require-admin";