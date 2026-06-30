/**
 * Dashboard stats helpers.
 *
 * Pure read-only helpers that aggregate counts from the database for
 * the dashboard view. Each helper takes an explicit `db: TestDb` so
 * unit tests can drive it with a fresh in-memory shim — no singleton
 * coupling.
 *
 * Public surface (all take `userId` only and resolve `db` via
 * `getTestDb()`; the underlying `__<name>Internal` helpers take an
 * explicit `db` for hermetic tests):
 *
 *   - `getDashboardStats(userId)` — unread-inbound count.
 *   - `getMessageVolume30d(userId)` — daily message-count series
 *     for the last 30 calendar days (including today), with gap
 *     days filled with `0`.
 *   - `getRecentActivity(userId, limit?)` — merged feed of the
 *     user's most recent outbound (`messages`) and inbound
 *     (`inbound_messages`) rows, sorted desc by `createdAt`.
 *
 * The split mirrors the action pattern used elsewhere in the app
 * (`__<name>Internal` accepts `db` for tests; the public wrapper
 * resolves it via `getTestDb()`).
 */

import type { TestDb } from "@/test/db";
import { getTestDb } from "@/test/db";

// ============================================================================
// Existing: unread-inbound count
// ============================================================================

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
 * Resolves the singleton `db` via `getTestDb()` — for hermetic
 * tests, use `__getDashboardStatsInternal({ userId, db })`
 * directly with a fresh `createTestDb()`.
 *
 * The current implementation only surfaces the unread-inbound count;
 * future dashboard stories (a different US) will extend this shape
 * with sent-this-month, credit-balance, etc.
 */
export async function getDashboardStats(
  userId: number,
): Promise<DashboardStats> {
  return __getDashboardStatsInternal({ userId, db: getTestDb() });
}

/**
 * Test seam: compute the dashboard stats with an explicit `db`.
 * Mirrors the public `getDashboardStats(userId)` wrapper — the
 * split lets tests drive the helper with a fresh
 * `createTestDb()` instead of the singleton, so two parallel
 * tests don't trample each other's rows.
 */
export async function __getDashboardStatsInternal(args: {
  userId: number;
  db: TestDb;
}): Promise<DashboardStats> {
  const { userId, db } = args;
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`getDashboardStats: userId must be a positive integer`);
  }
  const rows = await db.select("inbound_messages", {
    user_id: userId,
    read: false,
  });
  return { unread: rows.length };
}

// ============================================================================
// US-020: 30-day message-volume series
// ============================================================================

/**
 * One day in the 30-day series. The `date` is a calendar day in
 * `YYYY-MM-DD` (UTC) — keyed, sortable, locale-free, and stable
 * regardless of the test run's clock.
 */
export interface MessageVolumeDay {
  /** Calendar day in `YYYY-MM-DD` (UTC). */
  date: string;
  /** Number of `messages` rows the user created on that day. */
  count: number;
}

/**
 * Number of trailing calendar days (inclusive of today) the
 * `getMessageVolume30d()` helper returns by default. The series
 * always covers exactly this many entries (with `count=0` on gap
 * days) so chart rendering can size its x-axis without consulting
 * the result.
 */
export const DASHBOARD_VOLUME_DAYS = 30;

/**
 * Read the user's outbound-message volume for the last 30 calendar
 * days (inclusive of today).
 *
 * Returns exactly {@link DASHBOARD_VOLUME_DAYS} entries, ordered
 * from oldest to newest (i.e. today is the LAST entry), with
 * `count=0` on any day the user sent no messages. The "today"
 * anchor defaults to the current wall-clock time but can be
 * overridden via the underlying internal helper for tests.
 *
 * Scope:
 *   - Always filtered by `userId`. No cross-tenant leakage.
 *   - Bucket key is `YYYY-MM-DD` in UTC — the chart shows day-level
 *     totals so an in-day timezone shift is not material for the
 *     scale (one day) this dashboard surfaces.
 *
 * Counts every `messages` row the user created in the window,
 * regardless of `status`. We deliberately include scheduled,
 * cancelled, queued, and failed rows because the dashboard
 * surfaces activity ("how busy am I being?") not delivery
 * success.
 */
export async function getMessageVolume30d(
  userId: number,
): Promise<MessageVolumeDay[]> {
  return __getMessageVolume30dInternal({
    userId,
    db: getTestDb(),
    now: new Date(),
  });
}

/**
 * Test seam: compute the 30-day message-volume series with an
 * explicit `db` and a fixed `now` anchor. Lets unit tests pin
 * "today" so day-boundary assertions don't depend on the clock.
 */
export async function __getMessageVolume30dInternal(args: {
  userId: number;
  db: TestDb;
  now: Date;
}): Promise<MessageVolumeDay[]> {
  const { userId, db, now } = args;
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      `__getMessageVolume30dInternal: userId must be a positive integer (got ${userId})`,
    );
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(
      `__getMessageVolume30dInternal: now must be a valid Date`,
    );
  }

  // Lower bound (UTC): midnight of (today − (DASHBOARD_VOLUME_DAYS − 1)).
  // We want exactly N entries ending at "today", so the oldest entry
  // covers the calendar day N-1 days before today at 00:00 UTC.
  const todayUtcMidnight = startOfUtcDay(now);
  const fromMs = todayUtcMidnight.getTime() - (DASHBOARD_VOLUME_DAYS - 1) * 86_400_000;
  const toMs = todayUtcMidnight.getTime() + 86_400_000; // half-open upper bound

  const rows = await db.select("messages", { user_id: userId });

  const counts = new Map<string, number>();
  for (const r of rows) {
    const ts = coerceTimestamp(r.created_at);
    if (ts === null) continue;
    const t = ts.getTime();
    if (t < fromMs || t >= toMs) continue;
    const key = formatUtcDay(ts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Build the full 30-entry series, oldest -> newest, filling gaps
  // with 0. The chart x-axis reads left-to-right so callers expect
  // the oldest day first.
  const series: MessageVolumeDay[] = [];
  for (let i = 0; i < DASHBOARD_VOLUME_DAYS; i++) {
    const dayMs = fromMs + i * 86_400_000;
    const day = new Date(dayMs);
    const key = formatUtcDay(day);
    series.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

// ============================================================================
// US-020: recent-activity merged feed
// ============================================================================

/**
 * Source stream a {@link ActivityItem} came from. Used by the page
 * to label the row ("Outbound" vs "Inbound") and to pick the right
 * timestamp column when rendering — outbound rows show
 * `createdAt`, inbound rows show `receivedAt` if you ever need
 * to disambiguate, though both are surfaced as `createdAt` here.
 */
export type ActivitySource = "outbound" | "inbound";

/**
 * One entry in the merged recent-activity feed. The shape is the
 * union of the fields the dashboard list needs from both tables —
 * `id` and `body` are present on both, `from` is either
 * `messages.from_number` (outbound) or `inbound_messages.from_phone`
 * (inbound). Adding more fields later is a non-breaking change for
 * callers because the field names are stable.
 */
export interface ActivityItem {
  /** Source stream the row came from. */
  source: ActivitySource;
  /** Primary key from the underlying table. */
  id: number;
  /** Body text of the message. */
  body: string;
  /**
   * Phone number relevant to the row. For outbound this is the
   * sender; for inbound this is the sender's phone (the user's
   * own number is also persisted separately on the inbound row
   * but the dashboard's "From" column is the external party).
   */
  from: string;
  /** Row creation timestamp (UTC). */
  createdAt: Date;
}

/**
 * Default merge limit: number of OUTBOUND rows to pull when
 * building the merged feed. Mirrors the value cited in the
 * story spec ("latest 10 messages rows"). The matching inbound
 * batch size is half of this — see
 * {@link __getRecentActivityInternal}.
 */
export const DASHBOARD_RECENT_OUTBOUND_LIMIT = 10;

/**
 * Inbound batch is half the outbound limit, so a default
 * `limit=10` produces the 10 + 5 shape the story spec calls
 * for. Capped at 1 so a `limit=0` call still yields an inbound
 * row or two.
 */
function inboundLimitFor(limit: number): number {
  return Math.max(1, Math.floor(limit / 2));
}

/**
 * Return the user's merged recent-activity feed (newest first).
 *
 * Behavior:
 *   - Reads the user's {@link DASHBOARD_RECENT_OUTBOUND_LIMIT} most
 *     recent `messages` rows + the matching half-most-recent
 *     `inbound_messages` rows.
 *   - Merges them into a single array sorted by `createdAt` desc.
 *   - Returns the merged array (capped at 15 in the default case —
 *     10 outbound + 5 inbound) — `limit` controls both batch
 *     sizes.
 *
 * Scope:
 *   - Always filtered by `userId`. No cross-tenant leakage.
 *
 * Notes:
 *   - The merge is purely chronological — there's no de-duplication
 *     across the two tables. An outbound-then-inbound reply pair
 *     shows as two rows. That's intentional: the dashboard surfaces
 *     activity as a flat timeline.
 *   - Each batch is read independently because the shim's `select`
 *     only supports equality predicates; we sort the user-scoped
 *     reads in JS before merging. Real Postgres (when wired in)
 *     will use `ORDER BY created_at DESC LIMIT $n`.
 */
export async function getRecentActivity(
  userId: number,
  limit: number = DASHBOARD_RECENT_OUTBOUND_LIMIT,
): Promise<ActivityItem[]> {
  return __getRecentActivityInternal({
    userId,
    limit,
    db: getTestDb(),
    now: new Date(),
  });
}

/**
 * Test seam: compute the recent-activity merged feed with an
 * explicit `db` and `now`. The `now` anchor is currently unused
 * by the implementation (the merge is window-free) but is part
 * of the shape so future stories that add a "since" filter don't
 * require a signature change.
 */
export async function __getRecentActivityInternal(args: {
  userId: number;
  limit?: number;
  db: TestDb;
  now: Date;
}): Promise<ActivityItem[]> {
  const { userId, db } = args;
  const limit = args.limit ?? DASHBOARD_RECENT_OUTBOUND_LIMIT;
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      `__getRecentActivityInternal: userId must be a positive integer (got ${userId})`,
    );
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      `__getRecentActivityInternal: limit must be a positive integer (got ${limit})`,
    );
  }

  const inboundMax = inboundLimitFor(limit);

  // Pull the latest `limit` outbound + `inboundMax` inbound rows for
  // this user. Sort + cap each in JS because the shim doesn't do
  // ORDER BY or LIMIT.
  const outboundRows = (
    await db.select("messages", { user_id: userId })
  )
    .sort((a, b) => sortDescByCreatedAt(a, b))
    .slice(0, limit);

  const inboundRows = (
    await db.select("inbound_messages", { user_id: userId })
  )
    .sort((a, b) => sortDescByCreatedAt(a, b))
    .slice(0, inboundMax);

  const merged: ActivityItem[] = [];
  for (const r of outboundRows) {
    const ts = coerceTimestamp(r.created_at);
    if (ts === null) continue;
    merged.push({
      source: "outbound",
      id: typeof r.id === "number" ? (r.id as number) : 0,
      body: String(r.body ?? ""),
      from: String(r.from_number ?? ""),
      createdAt: ts,
    });
  }
  for (const r of inboundRows) {
    const ts = coerceTimestamp(r.created_at);
    if (ts === null) continue;
    merged.push({
      source: "inbound",
      id: typeof r.id === "number" ? (r.id as number) : 0,
      body: String(r.body ?? ""),
      from: String(r.from_phone ?? ""),
      createdAt: ts,
    });
  }

  merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return merged;
}

// ============================================================================
// Internal date helpers (UTC, locale-free)
// ============================================================================

/**
 * Coerce a `created_at` cell from the in-memory shim (always a
 * `Date`) or a real Postgres `timestamptz` (string or `Date`) into
 * a `Date`. Returns `null` for missing / unparseable values so the
 * caller can skip the row.
 */
function coerceTimestamp(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t);
  }
  return null;
}

/**
 * Sort comparator: `createdAt` desc, ties broken by `id` desc so
 * the result is stable across runs. Both arguments come from the
 * in-memory shim's `select` output.
 */
function sortDescByCreatedAt(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const ta = coerceTimestamp(a.created_at)?.getTime() ?? 0;
  const tb = coerceTimestamp(b.created_at)?.getTime() ?? 0;
  if (ta !== tb) return tb - ta;
  const ia = typeof a.id === "number" ? (a.id as number) : 0;
  const ib = typeof b.id === "number" ? (b.id as number) : 0;
  return ib - ia;
}

/**
 * Return the UTC midnight of the day containing `d`.
 */
function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/**
 * Format a `Date` as `YYYY-MM-DD` in UTC. Pad every component to
 * two digits so sort order matches lexical order.
 */
function formatUtcDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
