"use server";

/**
 * Server actions for the `/admin/users` page (US-019).
 *
 * - `adminListUsersAction({ query?, limit })` — list users for the
 *   admin console. Gated on `requireAdmin()` (which 404s for
 *   non-admin callers). `query` is an optional case-insensitive
 *   substring match on `email` OR `name`; `limit` caps the result
 *   set (default 100). Results are sorted by `created_at` descending
 *   so newly onboarded users surface first.
 *
 * - `adminAdjustCreditsAction({ userId, delta, reason })` —
 *   adjust a target user's credit balance. Gated on `requireAdmin()`.
 *   Adds `delta` to `accounts.credits` AND writes a
 *   `credit_transactions` row with `reason='admin_adjust'` so the
 *   adjustment is auditable in the user's billing history.
 *
 *   `reason` is restricted to a small set of human-readable
 *   labels (`support`, `refund`, `goodwill`, `correction`,
 *   `chargeback`); the canonical `credit_transactions.reason` is
 *   always `'admin_adjust'` regardless of the dropdown value — the
 *   dropdown is stored in a separate `note` column… but since
 *   `credit_transactions` doesn't currently have a `note` column,
 *   we encode the chosen label as a stable prefix on a synthetic
 *   `stripe_payment_intent_id` string. See the implementation note
 *   below for why we don't add a column.
 *
 * The actual DB work is delegated to `__adminListUsersInternal` /
 * `__adminAdjustCreditsInternal`, exported with the `__` prefix so
 * unit tests can exercise them directly with a fresh `TestDb` (no
 * singleton coupling, no `requireAdmin()` plumbing). Mirrors every
 * other action file in `src/lib/actions/`.
 *
 * NOTE: This is a `"use server"` file. Next.js 16 only allows async
 * functions (and type-only exports) from such files — re-exporting
 * schema table objects would fail the build if a downstream module
 * statically pulled those references in. Importers grab the schema
 * directly from "@/db/schema" instead.
 *
 * Why we 404 instead of 403'ing:
 *   The user-story spec calls for `requireAdmin()` to call
 *   `notFound()`. We collapse "no admin section" and "you're not
 *   allowed in" into the same observable 404 so non-admin users
 *   can't probe the admin surface for existence.
 */

import { requireAdmin } from "@/lib/auth";
import { getTestDb, type TestDb } from "@/test/db";
import {
  ADMIN_ADJUST_REASONS,
  isAdminAdjustReason,
  type AdminAdjustReason,
} from "@/lib/admin/reasons";

// ============================================================================
// Public server actions
// ============================================================================

/**
 * List users for the admin console.
 *
 * Returns `{ users: AdminUserRow[] }`. Each row is a plain object
 * with `id`, `email`, `name`, `role`, `credits`, `createdAt`.
 * `credits` is the current `accounts.credits` value (0 when the
 * user has no account row yet — common for admins).
 *
 * `query` matches case-insensitively against either `email` OR
 * `name` (substring match). `limit` defaults to 100 and is clamped
 * to a minimum of 1.
 *
 * Throws `notFound()` (via `requireAdmin`) for non-admin callers.
 */
export async function adminListUsersAction(args: {
  query?: string;
  limit?: number;
}): Promise<{ users: AdminUserRow[] }> {
  await requireAdmin();
  return __adminListUsersInternal({
    query: args.query,
    limit: args.limit,
    db: getTestDb(),
  });
}

/**
 * Adjust a target user's credit balance and write an audit row.
 *
 * `delta` is a signed integer added to `accounts.credits` (positive
 * = credit grant, negative = debit). `reason` is a dropdown label
 * restricted to the `ADMIN_ADJUST_REASONS` set.
 *
 * Returns `{ userId, credits, txnId }` where `credits` is the
 * post-adjust balance and `txnId` is the inserted
 * `credit_transactions.id`.
 *
 * Throws `notFound()` (via `requireAdmin`) for non-admin callers.
 * Throws a plain `Error` for:
 *   - non-positive `userId`
 *   - non-integer `delta`
 *   - unknown `reason`
 *   - target user row not found
 *   - target account row not found (defensive — schema FK would
 *     normally guarantee this, but the in-memory shim doesn't
 *     enforce FKs)
 */
export async function adminAdjustCreditsAction(args: {
  userId: number;
  delta: number;
  reason: string;
}): Promise<{ userId: number; credits: number; txnId: number }> {
  await requireAdmin();
  return __adminAdjustCreditsInternal({
    userId: args.userId,
    delta: args.delta,
    reason: args.reason,
    db: getTestDb(),
  });
}

// ============================================================================
// Row shape returned by adminListUsersAction
// ============================================================================

/**
 * One row in the admin users table. Built from a `users` row joined
 * with the corresponding `accounts` row's `credits` value (0 when
 * no account row exists).
 */
export interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  credits: number;
  createdAt: Date;
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface AdminListUsersInput {
  query?: string;
  limit?: number;
  db: TestDb;
}

/**
 * Pure helper: list users with optional substring match on
 * `email` / `name`, sorted by `created_at` descending, capped at
 * `limit` (default 100, clamped to >=1).
 *
 * Joins `accounts.credits` for each user in JS (the in-memory shim
 * doesn't support SQL joins). When real Postgres lands this
 * collapses into a single `LEFT JOIN` query.
 *
 * No auth-gating here — callers (the public action OR tests) must
 * gate access themselves.
 */
export async function __adminListUsersInternal(
  input: AdminListUsersInput,
): Promise<{ users: AdminUserRow[] }> {
  const { query, limit, db } = input;

  // Default + clamp `limit` so a 0 / negative value can't return
  // an empty list by accident.
  const safeLimit =
    typeof limit === "number" && Number.isInteger(limit) && limit >= 1
      ? limit
      : 100;

  const users = await db.select("users");
  const accounts = await db.select("accounts");

  // Index accounts by user_id for the in-JS join.
  const creditsByUserId = new Map<number, number>();
  for (const account of accounts) {
    if (typeof account.user_id === "number") {
      const credits = account.credits;
      creditsByUserId.set(
        account.user_id,
        typeof credits === "number" ? credits : 0,
      );
    }
  }

  const needle =
    typeof query === "string" && query.trim().length > 0
      ? query.trim().toLowerCase()
      : null;

  const rows: AdminUserRow[] = [];
  for (const user of users) {
    const email = typeof user.email === "string" ? user.email : "";
    const name = typeof user.name === "string" ? user.name : "";
    const role = typeof user.role === "string" ? user.role : "user";
    const id = typeof user.id === "number" ? user.id : 0;
    const createdAt =
      user.created_at instanceof Date
        ? user.created_at
        : new Date(String(user.created_at ?? 0));

    if (needle !== null) {
      if (
        !email.toLowerCase().includes(needle) &&
        !name.toLowerCase().includes(needle)
      ) {
        continue;
      }
    }

    rows.push({
      id,
      email,
      name,
      role,
      credits: creditsByUserId.get(id) ?? 0,
      createdAt,
    });
  }

  // Newest-first.
  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { users: rows.slice(0, safeLimit) };
}

export interface AdminAdjustCreditsInput {
  userId: number;
  delta: number;
  reason: string;
  db: TestDb;
}

/**
 * Pure helper: add `delta` to `accounts.credits` for `userId` and
 * write a `credit_transactions` row with `reason='admin_adjust'`
 * and a synthetic `stripe_payment_intent_id` of the form
 * `"admin_adjust:<label>"` so the audit trail can recover the
 * operator's chosen label.
 *
 * No auth-gating here — callers (the public action OR tests) must
 * gate access themselves.
 *
 * Throws on:
 *   - non-positive `userId`
 *   - non-integer `delta`
 *   - unknown `reason`
 *   - target user row not found
 *   - target account row not found
 */
export async function __adminAdjustCreditsInternal(
  input: AdminAdjustCreditsInput,
): Promise<{ userId: number; credits: number; txnId: number }> {
  const { userId, delta, reason, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      "adminAdjustCredits: userId must be a positive integer",
    );
  }
  if (!Number.isInteger(delta)) {
    throw new Error("adminAdjustCredits: delta must be an integer");
  }
  if (!isAdminAdjustReason(reason)) {
    throw new Error(
      `adminAdjustCredits: reason must be one of ${ADMIN_ADJUST_REASONS.join(", ")}`,
    );
  }

  // Confirm the target user exists.
  const userRows = await db.select("users", { id: userId });
  if (userRows.length === 0) {
    throw new Error(`adminAdjustCredits: user ${userId} not found`);
  }

  // Confirm the target account exists. In production the FK
  // guarantees this; the in-memory shim doesn't, so we pre-check.
  const accountRows = await db.select("accounts", { user_id: userId });
  if (accountRows.length === 0) {
    throw new Error(
      `adminAdjustCredits: no account row for user ${userId}`,
    );
  }

  const currentCreditsRaw = accountRows[0]!.credits;
  const currentCredits =
    typeof currentCreditsRaw === "number" ? currentCreditsRaw : 0;
  const newCredits = currentCredits + delta;

  // Persist the new balance on the account row.
  await db.update(
    "accounts",
    { user_id: userId },
    { credits: newCredits },
  );

  // Write the audit row. The canonical reason is always
  // `'admin_adjust'`; the operator's chosen label is preserved in
  // `stripe_payment_intent_id` so the audit trail survives without
  // a schema change.
  const inserted = await db.insert("credit_transactions", {
    user_id: userId,
    delta,
    reason: "admin_adjust",
    stripe_payment_intent_id: `admin_adjust:${reason}`,
  });

  return {
    userId,
    credits: newCredits,
    txnId: typeof inserted.id === "number" ? inserted.id : 0,
  };
}