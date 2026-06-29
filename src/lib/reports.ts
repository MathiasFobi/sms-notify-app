/**
 * Delivery report helper for the `/app/reports` page.
 *
 * Returns a per-message breakdown of what was sent in the requested
 * window, plus the headline counts (`totalSent`, `totalDelivered`,
 * `totalFailed`) the page renders in its delivery-summary card.
 *
 * Scope:
 *   - Always filtered by `userId` (no cross-tenant leakage).
 *   - Filtered by `messages.sent_at` falling inside `[from, to)`.
 *     Rows whose `sent_at` is `null` (e.g. `status='scheduled'` or
 *     `status='cancelled'`) are EXCLUDED — they're not part of
 *     "what was sent". The range defaults to the last 30 days
 *     when `from` is omitted.
 *
 * Counts:
 *   - `totalSent`     = messages with status in ('sent','delivered','failed')
 *                       — i.e. everything that left the queue but isn't
 *                       still scheduled/cancelled.
 *   - `totalDelivered` = messages with status = 'delivered'.
 *   - `totalFailed`   = messages with status = 'failed'.
 *
 * Per-message roll-up:
 *   - `recipientCount`  = total `message_recipients` rows for the message.
 *   - `deliveredCount`  = recipients with `status='delivered'`.
 *   - `failedCount`     = recipients with `status='failed'`.
 *   - `deliveredAt`     = max(recipient.delivered_at), used as the
 *                         "this message finished delivering" timestamp
 *                         for the row.
 *
 * Designed to be unit-testable with a fresh `createTestDb()` (no
 * `requireUser()` plumbing). The page itself reads via the singleton
 * `getTestDb()`.
 */

import type { TestDb } from "@/test/db";

// ============================================================================
// Public surface
// ============================================================================

/**
 * Time window for a report. Either bound may be omitted; the helper
 * defaults `from` to `now - 30 days` and `to` to `now + 1 ms` (a
 * half-open upper bound so a `sent_at` exactly equal to `to` is
 * excluded, matching the standard `[from, to)` convention).
 */
export interface ReportRange {
  from?: Date;
  to?: Date;
}

export interface PerMessageReport {
  id: number;
  body: string;
  status: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  sentAt: Date | null;
  deliveredAt: Date | null;
}

export interface DeliveryReport {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  perMessage: PerMessageReport[];
}

/**
 * Statuses that count as "sent" for the `totalSent` headline. We
 * include `delivered` and `failed` because those rows DID leave the
 * queue — they just ended differently. `scheduled` and `cancelled`
 * are excluded because they never made it out.
 */
const SENT_STATUSES = new Set(["sent", "delivered", "failed"]);

/**
 * Lower bound on the message id used by the shim's `nextId`. Real
 * Postgres serializes from 1, so a `null`/`undefined` `id` from a
 * fresh insert would be 0 in the shim. We clamp to >=1 to skip
 * defensive zero-checks at every call site.
 */
const MIN_MESSAGE_ID = 1;

// ============================================================================
// Entry point
// ============================================================================

/**
 * Compute the delivery report for `userId` in `range`.
 *
 * Both bounds are inclusive on `from` and exclusive on `to`. Rows
 * with `sent_at` outside the window — or null — are filtered out
 * before any counting happens.
 */
export async function getDeliveryReport(
  userId: number,
  range: ReportRange = {},
  db: TestDb,
): Promise<DeliveryReport> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`getDeliveryReport: invalid userId ${userId}`);
  }

  const now = new Date();
  const from = range.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = range.to ?? new Date(now.getTime() + 1);

  // Pull every message for this user in one shot; the in-memory shim
  // does not support range predicates so we filter in JS. Real
  // Postgres (when wired in) will use `WHERE user_id = $1 AND
  // sent_at >= $2 AND sent_at < $3`. Same observable result.
  const userMessages = await db.select("messages", { user_id: userId });

  const inWindow = userMessages.filter((m) => {
    const sentAt = m.sent_at;
    if (!(sentAt instanceof Date) && typeof sentAt !== "string") return false;
    const t = (sentAt as Date | string).valueOf
      ? (sentAt as Date).getTime()
      : Date.parse(String(sentAt));
    if (Number.isNaN(t)) return false;
    return t >= from.getTime() && t < to.getTime();
  });

  const perMessage: PerMessageReport[] = [];
  let totalSent = 0;
  let totalDelivered = 0;
  let totalFailed = 0;

  for (const m of inWindow) {
    const id = typeof m.id === "number" ? (m.id as number) : 0;
    if (id < MIN_MESSAGE_ID) continue;
    const status = String(m.status ?? "");
    const sentAt = (m.sent_at as Date | null) ?? null;
    const body = String(m.body ?? "");

    // Per-recipient roll-up. The shim supports `select(table, where)`
    // with equality predicates, so scoping by `message_id` is fine.
    const recipients = await db.select("message_recipients", {
      message_id: id,
    });
    let deliveredCount = 0;
    let failedCount = 0;
    let latestDeliveredAt: number | null = null;
    for (const r of recipients) {
      const rStatus = String(r.status ?? "");
      if (rStatus === "delivered") {
        deliveredCount++;
        const dt = (r.delivered_at as Date | null) ?? null;
        if (dt instanceof Date) {
          const t = dt.getTime();
          if (latestDeliveredAt === null || t > latestDeliveredAt) {
            latestDeliveredAt = t;
          }
        }
      } else if (rStatus === "failed") {
        failedCount++;
      }
    }

    perMessage.push({
      id,
      body,
      status,
      recipientCount: recipients.length,
      deliveredCount,
      failedCount,
      sentAt,
      deliveredAt:
        latestDeliveredAt !== null ? new Date(latestDeliveredAt) : null,
    });

    if (SENT_STATUSES.has(status)) totalSent++;
    if (status === "delivered") totalDelivered++;
    if (status === "failed") totalFailed++;
  }

  // Newest first — mirrors the inbox / billing pages so users see
  // their most recent sends at the top of the table.
  perMessage.sort((a, b) => {
    const at = a.sentAt?.getTime() ?? 0;
    const bt = b.sentAt?.getTime() ?? 0;
    return bt - at;
  });

  return { totalSent, totalDelivered, totalFailed, perMessage };
}