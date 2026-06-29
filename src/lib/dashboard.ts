/**
 * Dashboard stats helpers.
 *
 * Pure read-only helpers that aggregate counts from the database for
 * the dashboard view. Each helper takes an explicit `db: TestDb` so
 * unit tests can drive it with a fresh in-memory shim — no singleton
 * coupling.
 *
 * Currently exposes a single helper, `getDashboardStats(userId, db)`,
 * which returns a small shape covering the counts the dashboard
 * surfaces. Only the fields that have a backing implementation are
 * included; new fields land here as the dashboard stories (a future
 * US) introduce them.
 */

import type { TestDb } from "@/test/db";

export interface DashboardStats {
  /**
   * Number of inbound messages received on the user's Twilio number
   * that have NOT yet been marked read via `markReadAction` /
   * `markAllReadAction`. Drives the "unread" badge on the inbox and
   * any future dashboard tile.
   */
  unread: number;
}

/**
 * Read aggregate counts for the dashboard.
 *
 * The current implementation only surfaces the unread-inbound count;
 * future dashboard stories (a different US) will extend this shape
 * with sent-this-month, credit-balance, etc.
 */
export async function getDashboardStats(
  userId: number,
  db: TestDb,
): Promise<DashboardStats> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`getDashboardStats: userId must be a positive integer`);
  }
  const rows = await db.select("inbound_messages", {
    user_id: userId,
    read: false,
  });
  return { unread: rows.length };
}