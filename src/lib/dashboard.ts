import { and, eq, gte, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { accounts, inboundMessages, messages } from "@/db/schema";

/**
 * Aggregate counts for the client dashboard.
 *
 * `getDashboardStats` is the single source of truth for the four
 * stat cards on /app/dashboard:
 *
 *  - `credits`     — current credit balance for the user.
 *  - `messages30d` — number of *outbound* messages created in
 *                    the last 30 days. Counts every message the
 *                    user has sent or scheduled, regardless of
 *                    recipient count, so it matches the "Messages
 *                    sent" wording on the spec.
 *  - `scheduled`   — number of distinct messages whose
 *                    `status = 'scheduled'`. This is the user-
 *                    facing count; the row count in
 *                    `scheduledJobs` would double-count if a job
 *                    is retried, so we use the message table.
 *  - `unread`      — number of inbound messages with
 *                    `read = false`. Joins on the user's
 *                    inbound mailbox.
 *
 * All counts are returned as integers; `0` when the user has no
 * rows. The function is intentionally side-effect free so it's
 * cheap to test against an in-memory PGlite database.
 *
 * A `db` argument is accepted so the tests can pass a PGlite
 * instance via `src/test/db.ts`. Production callers omit the
 * argument and the real `@/db` is used.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type DashboardStats = {
  credits: number;
  messages30d: number;
  scheduled: number;
  unread: number;
};

export async function getDashboardStats(
  userId: number,
  dbOverride: typeof defaultDb = defaultDb,
): Promise<DashboardStats> {
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  const [creditsRow] = await dbOverride
    .select({ credits: accounts.credits })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .limit(1);

  const [messagesRow] = await dbOverride
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        gte(messages.createdAt, thirtyDaysAgo),
      ),
    );

  const [scheduledRow] = await dbOverride
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(eq(messages.userId, userId), eq(messages.status, "scheduled")),
    );

  const [unreadRow] = await dbOverride
    .select({ count: sql<number>`count(*)::int` })
    .from(inboundMessages)
    .where(
      and(
        eq(inboundMessages.userId, userId),
        eq(inboundMessages.read, false),
      ),
    );

  return {
    credits: creditsRow?.credits ?? 0,
    messages30d: messagesRow?.count ?? 0,
    scheduled: scheduledRow?.count ?? 0,
    unread: unreadRow?.count ?? 0,
  };
}
