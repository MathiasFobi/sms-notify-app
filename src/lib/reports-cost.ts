/**
 * Cost summary helper for the `/app/reports` page.
 *
 * Aggregates the user's `credit_transactions` ledger into three
 * headline numbers for the cost-summary card:
 *
 *   - `totalSpent`     — sum of credits spent on sends. We pull every
 *                        row whose `reason='send'` and `delta < 0`,
 *                        then negate the sum so the result is reported
 *                        as a positive number (credits spent, not the
 *                        raw ledger delta).
 *   - `totalPurchased` — sum of positive deltas with `reason='purchase'`.
 *                        Refund-paired credits (which are negative
 *                        deltas against a purchase) are excluded by
 *                        the `delta > 0` guard.
 *   - `totalRefunds`   — sum of positive deltas with `reason='refund'`.
 *                        Mirrors `totalPurchased`'s guard. When a
 *                        refund is recorded in the ledger it is
 *                        stored as a positive delta (see
 *                        `__recordRefundInternal` in
 *                        `src/lib/actions/billing.ts`), so this
 *                        matches the live schema.
 *
 * Scope:
 *   - Always filtered by `userId`. No cross-tenant leakage.
 *   - Filtered by `created_at` falling inside `[from, to)`. Same
 *     half-open convention as `getDeliveryReport`. `from` defaults
 *     to 30 days ago; `to` defaults to `now + 1 ms`.
 */

import type { TestDb } from "@/test/db";

// ============================================================================
// Public surface
// ============================================================================

export interface ReportRange {
  from?: Date;
  to?: Date;
}

export interface CostSummary {
  totalSpent: number;
  totalPurchased: number;
  totalRefunds: number;
}

// ============================================================================
// Entry point
// ============================================================================

export async function getCostSummary(
  userId: number,
  range: ReportRange = {},
  db: TestDb,
): Promise<CostSummary> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`getCostSummary: invalid userId ${userId}`);
  }

  const now = new Date();
  const from = range.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = range.to ?? new Date(now.getTime() + 1);
  const fromMs = from.getTime();
  const toMs = to.getTime();

  // The in-memory shim doesn't support `IN` / `BETWEEN` so we
  // SELECT every row for the user and filter in JS. Real Postgres
  // (when wired in) will use `WHERE user_id = $1 AND created_at
  // >= $2 AND created_at < $3 AND reason = $4`. Same observable
  // result; same ledger.
  const rows = await db.select("credit_transactions", { user_id: userId });

  let totalSpent = 0; // positive number = credits spent
  let totalPurchased = 0; // positive number = credits bought
  let totalRefunds = 0; // positive number = credits refunded

  for (const row of rows) {
    const createdAt = row.created_at;
    const t =
      createdAt instanceof Date
        ? createdAt.getTime()
        : typeof createdAt === "string"
          ? Date.parse(createdAt)
          : Number.NaN;
    if (Number.isNaN(t) || t < fromMs || t >= toMs) continue;

    const reason = String(row.reason ?? "");
    const delta = typeof row.delta === "number" ? (row.delta as number) : 0;

    if (reason === "send" && delta < 0) {
      // Negate so `totalSpent` is reported as a positive number.
      totalSpent += -delta;
    } else if (reason === "purchase" && delta > 0) {
      totalPurchased += delta;
    } else if (reason === "refund" && delta > 0) {
      totalRefunds += delta;
    }
  }

  return { totalSpent, totalPurchased, totalRefunds };
}