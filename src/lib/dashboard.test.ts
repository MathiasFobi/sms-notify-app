/**
 * Tests for `src/lib/dashboard.ts` (US-020).
 *
 * Coverage:
 *
 *   `getDashboardStats` (existing, kept here so the dashboard module
 *     has a single test file):
 *     - returns `{ unread: <count of unread inbound_messages> }`.
 *     - scopes by `userId` (multi-tenant isolation).
 *
 *   `__getMessageVolume30dInternal`:
 *     - returns exactly 30 entries (DASHBOARD_VOLUME_DAYS).
 *     - fills gap days with `count=0`.
 *     - counts messages whose `created_at` falls on each UTC day.
 *     - excludes rows outside the 30-day window (older than 29 days).
 *     - counts every message regardless of `status` (scheduled,
 *       queued, failed included).
 *     - sorts oldest → newest (today is the LAST entry).
 *     - every `date` is `YYYY-MM-DD` UTC.
 *     - the series anchored on `now` puts `now`'s UTC day as the
 *       final entry.
 *     - `userId <= 0` throws.
 *     - `now` invalid throws.
 *     - multi-tenant isolation: a second user's messages are NOT
 *       bucketed into the first user's series.
 *
 *   `__getRecentActivityInternal`:
 *     - returns outbound + inbound rows merged sorted desc by
 *       `createdAt`.
 *     - default `limit=10` takes the 10 latest outbound + 5 latest
 *       inbound (= 15 rows when each stream has ≥ that many).
 *     - truncates each stream to its respective cap when there are
 *       more rows than the cap.
 *     - per-stream sort is desc by `createdAt`.
 *     - `source` is `'outbound'` for messages rows and `'inbound'`
 *       for inbound_messages rows.
 *     - `userId <= 0` throws.
 *     - `limit <= 0` throws.
 *     - multi-tenant isolation.
 *
 * All tests use a fresh `createTestDb()` per case so the in-memory
 * shim has no singleton coupling.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createTestDb, type TestDb } from "@/test/db";
import {
  __getDashboardStatsInternal,
  __getMessageVolume30dInternal,
  __getRecentActivityInternal,
  DASHBOARD_RECENT_OUTBOUND_LIMIT,
  DASHBOARD_VOLUME_DAYS,
} from "@/lib/dashboard";

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(
  db: TestDb,
  id: number,
  name = "Alice",
): Promise<void> {
  await db.insert("users", {
    id,
    email: `u${id}@example.com`,
    password_hash: "x",
    name,
  });
}

interface SeedInboundArgs {
  id: number;
  userId: number;
  fromPhone?: string;
  body?: string;
  createdAt?: Date;
  read?: boolean;
}

async function seedInbound(
  db: TestDb,
  args: SeedInboundArgs,
): Promise<void> {
  await db.insert("inbound_messages", {
    id: args.id,
    user_id: args.userId,
    from_phone: args.fromPhone ?? `+1555555010${args.id % 10}`,
    to_number: "+15555550199",
    body: args.body ?? `in-${args.id}`,
    twilio_message_sid: `IM${args.id}`,
    received_at: args.createdAt ?? new Date(),
    read: args.read ?? false,
    created_at: args.createdAt ?? new Date(),
  });
}

interface SeedMessageArgs {
  id: number;
  userId: number;
  body?: string;
  fromNumber?: string;
  status?: string;
  createdAt?: Date;
}

async function seedMessage(
  db: TestDb,
  args: SeedMessageArgs,
): Promise<void> {
  await db.insert("messages", {
    id: args.id,
    user_id: args.userId,
    body: args.body ?? `out-${args.id}`,
    from_number: args.fromNumber ?? "+15555550199",
    status: args.status ?? "sent",
    created_at: args.createdAt ?? new Date(),
  });
}

// ============================================================================
// getDashboardStats
// ============================================================================

describe("__getDashboardStatsInternal", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });

  it("counts unread inbound_messages for the user", async () => {
    await seedUser(db, 1);
    await seedInbound(db, { id: 1, userId: 1, read: false });
    await seedInbound(db, { id: 2, userId: 1, read: false });
    await seedInbound(db, { id: 3, userId: 1, read: true });

    const stats = await __getDashboardStatsInternal({ userId: 1, db });
    expect(stats.unread).toBe(2);
  });

  it("returns the user's account credits", async () => {
    await seedUser(db, 1);
    await db.insert("accounts", { user_id: 1, credits: 250 });
    const stats = await __getDashboardStatsInternal({ userId: 1, db });
    expect(stats.credits).toBe(250);
  });

  it("treats a missing account row as zero credits (low-balance CTA path)", async () => {
    await seedUser(db, 1);
    // No account insert.
    const stats = await __getDashboardStatsInternal({ userId: 1, db });
    expect(stats.credits).toBe(0);
  });

  it("does not leak credits across users", async () => {
    await seedUser(db, 1);
    await seedUser(db, 2);
    await db.insert("accounts", { user_id: 1, credits: 100 });
    await db.insert("accounts", { user_id: 2, credits: 999 });
    const a = await __getDashboardStatsInternal({ userId: 1, db });
    const b = await __getDashboardStatsInternal({ userId: 2, db });
    expect(a.credits).toBe(100);
    expect(b.credits).toBe(999);
  });

  it("scopes by userId — multi-tenant isolation", async () => {
    await seedUser(db, 1);
    await seedUser(db, 2);
    await seedInbound(db, { id: 1, userId: 1, read: false });
    await seedInbound(db, { id: 2, userId: 1, read: false });
    await seedInbound(db, { id: 3, userId: 2, read: false });
    await seedInbound(db, { id: 4, userId: 2, read: true });

    const stats = await __getDashboardStatsInternal({ userId: 1, db });
    expect(stats.unread).toBe(2);
  });

  it("returns zero when there is no inbox", async () => {
    await seedUser(db, 1);
    const stats = await __getDashboardStatsInternal({ userId: 1, db });
    expect(stats.unread).toBe(0);
  });

  it("throws on non-positive userId", async () => {
    await expect(
      __getDashboardStatsInternal({ userId: 0, db }),
    ).rejects.toThrow();
    await expect(
      __getDashboardStatsInternal({ userId: -1, db }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// __getMessageVolume30dInternal
// ============================================================================

describe("__getMessageVolume30dInternal", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });

  it("returns exactly DASHBOARD_VOLUME_DAYS entries", async () => {
    await seedUser(db, 1);
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T18:30:00Z"),
    });
    expect(series).toHaveLength(DASHBOARD_VOLUME_DAYS);
    expect(DASHBOARD_VOLUME_DAYS).toBe(30);
  });

  it("fills gap days with count=0", async () => {
    await seedUser(db, 1);
    // One message on the 5th day, nothing else.
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-05T10:00:00Z"),
    });

    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });

    const nonZero = series.filter((d) => d.count !== 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0]).toEqual({ date: "2026-06-05", count: 1 });
    expect(series.filter((d) => d.count === 0)).toHaveLength(
      DASHBOARD_VOLUME_DAYS - 1,
    );
  });

  it("counts multiple messages on the same day correctly", async () => {
    await seedUser(db, 1);
    for (let i = 0; i < 4; i++) {
      await seedMessage(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(`2026-06-10T0${i + 2}:00:00Z`),
      });
    }
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    const day = series.find((d) => d.date === "2026-06-10");
    expect(day).toEqual({ date: "2026-06-10", count: 4 });
  });

  it("counts messages regardless of status (scheduled, queued, failed)", async () => {
    await seedUser(db, 1);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "scheduled",
      createdAt: new Date("2026-06-20T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "queued",
      createdAt: new Date("2026-06-20T11:00:00Z"),
    });
    await seedMessage(db, {
      id: 3,
      userId: 1,
      status: "failed",
      createdAt: new Date("2026-06-20T12:00:00Z"),
    });
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    const day = series.find((d) => d.date === "2026-06-20");
    expect(day?.count).toBe(3);
  });

  it("excludes rows older than 29 days", async () => {
    await seedUser(db, 1);
    // 30 days before "now" is OUT of the window — series covers
    // [today - 29 .. today], so anything strictly older than
    // (today - 29 days) is excluded.
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-05-30T12:00:00Z"), // 30 days before 2026-06-29
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      createdAt: new Date("2026-05-15T12:00:00Z"), // 45 days before
    });

    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    expect(series.every((d) => d.count === 0)).toBe(true);
  });

  it("includes rows from (today - 29 days) onward", async () => {
    await seedUser(db, 1);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-05-31T23:59:00Z"), // 29 days before 2026-06-29 23:59 UTC
    });
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    const nonZero = series.filter((d) => d.count !== 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0].date).toBe("2026-05-31");
  });

  it("sorts oldest → newest (today is the LAST entry)", async () => {
    await seedUser(db, 1);
    const now = new Date("2026-06-29T12:00:00Z");
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now,
    });
    expect(series[0]?.date).toBe("2026-05-31");
    expect(series[DASHBOARD_VOLUME_DAYS - 1]?.date).toBe("2026-06-29");

    // Dates strictly increasing.
    for (let i = 1; i < series.length; i++) {
      expect(series[i]!.date > series[i - 1]!.date).toBe(true);
    }
  });

  it("anchors the series on `now`'s UTC day", async () => {
    await seedUser(db, 1);
    // `now` is well into the day; the final entry should still be the
    // UTC date of `now`, not the date of the next UTC midnight.
    const now = new Date("2026-12-15T18:30:00Z");
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now,
    });
    expect(series[series.length - 1]?.date).toBe("2026-12-15");
    expect(series[0]?.date).toBe("2026-11-16");
  });

  it("every date string is YYYY-MM-DD UTC", async () => {
    await seedUser(db, 1);
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T18:30:00Z"),
    });
    const re = /^\d{4}-\d{2}-\d{2}$/;
    for (const d of series) {
      expect(d.date).toMatch(re);
    }
  });

  it("scopes by userId — multi-tenant isolation", async () => {
    await seedUser(db, 1);
    await seedUser(db, 2);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-10T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 2,
      createdAt: new Date("2026-06-10T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 3,
      userId: 2,
      createdAt: new Date("2026-06-11T10:00:00Z"),
    });

    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    const day10 = series.find((d) => d.date === "2026-06-10");
    expect(day10).toEqual({ date: "2026-06-10", count: 1 });
    const day11 = series.find((d) => d.date === "2026-06-11");
    expect(day11).toEqual({ date: "2026-06-11", count: 0 });
  });

  it("returns an all-zero series when the user has no messages", async () => {
    await seedUser(db, 1);
    const series = await __getMessageVolume30dInternal({
      userId: 1,
      db,
      now: new Date("2026-06-29T12:00:00Z"),
    });
    expect(series.every((d) => d.count === 0)).toBe(true);
    expect(series).toHaveLength(DASHBOARD_VOLUME_DAYS);
  });

  it("throws on non-positive userId", async () => {
    await expect(
      __getMessageVolume30dInternal({
        userId: 0,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      __getMessageVolume30dInternal({
        userId: -1,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("throws when now is not a valid Date", async () => {
    await expect(
      __getMessageVolume30dInternal({
        userId: 1,
        db,
        now: new Date("not-a-date"),
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// __getRecentActivityInternal
// ============================================================================

describe("__getRecentActivityInternal", () => {
  let db: TestDb;
  beforeEach(() => {
    db = createTestDb();
  });

  it("merges outbound + inbound sorted desc by createdAt", async () => {
    await seedUser(db, 1);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-20T10:00:00Z"),
    });
    await seedInbound(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-21T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      createdAt: new Date("2026-06-22T10:00:00Z"),
    });
    await seedInbound(db, {
      id: 2,
      userId: 1,
      createdAt: new Date("2026-06-19T10:00:00Z"),
    });

    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });

    expect(result).toHaveLength(4);
    // Newest first across both streams:
    //   outbound id=2 (Jun 22) → inbound id=1 (Jun 21) →
    //   outbound id=1 (Jun 20) → inbound id=2 (Jun 19).
    expect(result.map((r) => r.id)).toEqual([2, 1, 1, 2]);
    expect(result.map((r) => r.source)).toEqual([
      "outbound",
      "inbound",
      "outbound",
      "inbound",
    ]);
    // Strictly descending timestamps.
    for (let i = 1; i < result.length; i++) {
      expect(
        result[i]!.createdAt.getTime() <= result[i - 1]!.createdAt.getTime(),
      ).toBe(true);
    }
  });

  it("default limit produces 10 outbound + 5 inbound (when both streams have enough rows)", async () => {
    await seedUser(db, 1);
    // 12 outbound messages; 7 inbound messages. Default limit=10
    // pulls 10 outbound + 5 inbound = 15 total.
    for (let i = 0; i < 12; i++) {
      await seedMessage(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(2026, 5, 20 + Math.floor(i / 4), i + 1, 0, 0),
      });
    }
    for (let i = 0; i < 7; i++) {
      await seedInbound(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(2026, 5, 21, i + 1, 0, 0),
      });
    }

    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });

    expect(result).toHaveLength(15);
    const outbound = result.filter((r) => r.source === "outbound");
    const inbound = result.filter((r) => r.source === "inbound");
    expect(outbound).toHaveLength(DASHBOARD_RECENT_OUTBOUND_LIMIT);
    expect(inbound).toHaveLength(5);
  });

  it("truncates each stream to its batch cap when more rows exist", async () => {
    await seedUser(db, 1);
    // 30 outbound rows; default limit caps to 10.
    for (let i = 0; i < 30; i++) {
      await seedMessage(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(2026, 5, 20, 0, i, 0),
      });
    }
    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });
    expect(result).toHaveLength(10);
    expect(result.every((r) => r.source === "outbound")).toBe(true);
  });

  it("per-stream sort is desc by createdAt before merge", async () => {
    await seedUser(db, 1);
    // Insert out of order; the helper must still emit newest-first.
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-15T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      createdAt: new Date("2026-06-22T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 3,
      userId: 1,
      createdAt: new Date("2026-06-18T10:00:00Z"),
    });

    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });
    expect(result.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("maps `from` to messages.from_number and inbound_messages.from_phone", async () => {
    await seedUser(db, 1);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      fromNumber: "+15555550100",
      createdAt: new Date("2026-06-20T10:00:00Z"),
    });
    await seedInbound(db, {
      id: 1,
      userId: 1,
      fromPhone: "+15555550199",
      createdAt: new Date("2026-06-21T10:00:00Z"),
    });

    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });
    const outbound = result.find((r) => r.source === "outbound");
    const inbound = result.find((r) => r.source === "inbound");
    expect(outbound?.from).toBe("+15555550100");
    expect(inbound?.from).toBe("+15555550199");
  });

  it("honors an explicit limit (smaller than the default)", async () => {
    await seedUser(db, 1);
    for (let i = 0; i < 10; i++) {
      await seedMessage(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(2026, 5, 20, 0, i, 0),
      });
    }
    for (let i = 0; i < 10; i++) {
      await seedInbound(db, {
        id: i + 1,
        userId: 1,
        createdAt: new Date(2026, 5, 21, 0, i, 0),
      });
    }
    const result = await __getRecentActivityInternal({
      userId: 1,
      limit: 4,
      db,
      now: new Date(),
    });
    // limit=4 → outbound cap 4, inbound cap 2 (floor(4/2)).
    expect(result).toHaveLength(6);
    const outbound = result.filter((r) => r.source === "outbound");
    const inbound = result.filter((r) => r.source === "inbound");
    expect(outbound).toHaveLength(4);
    expect(inbound).toHaveLength(2);
  });

  it("scopes by userId — multi-tenant isolation", async () => {
    await seedUser(db, 1);
    await seedUser(db, 2);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-20T10:00:00Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 2,
      createdAt: new Date("2026-06-21T10:00:00Z"),
    });
    await seedInbound(db, {
      id: 1,
      userId: 1,
      createdAt: new Date("2026-06-19T10:00:00Z"),
    });
    await seedInbound(db, {
      id: 2,
      userId: 2,
      createdAt: new Date("2026-06-22T10:00:00Z"),
    });

    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });
    expect(result.every((r) => r.source !== "outbound" || r.id === 1)).toBe(
      true,
    );
    expect(result.every((r) => r.source !== "inbound" || r.id === 1)).toBe(
      true,
    );
  });

  it("returns an empty array when the user has nothing", async () => {
    await seedUser(db, 1);
    const result = await __getRecentActivityInternal({
      userId: 1,
      db,
      now: new Date(),
    });
    expect(result).toEqual([]);
  });

  it("throws on non-positive userId", async () => {
    await expect(
      __getRecentActivityInternal({
        userId: 0,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      __getRecentActivityInternal({
        userId: -3,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("throws on non-positive limit", async () => {
    await expect(
      __getRecentActivityInternal({
        userId: 1,
        limit: 0,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
    await expect(
      __getRecentActivityInternal({
        userId: 1,
        limit: -1,
        db,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Misc
// ============================================================================

afterEach(() => {
  // Each test creates its own TestDb so there is nothing global to
  // reset. Keeping the hook here mirrors the rest of the test suite
  // and gives a future story an obvious place to add teardown if
  // these tests ever migrate to a singleton.
});
