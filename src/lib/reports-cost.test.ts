/**
 * Tests for `src/lib/reports-cost.ts` (US-017).
 *
 * Coverage:
 *
 *   1. `getCostSummary()` sums deltas correctly:
 *        - `totalSpent` = -sum(delta where reason='send' and delta<0)
 *        - `totalPurchased` = sum(delta where reason='purchase' and delta>0)
 *        - `totalRefunds` = sum(delta where reason='refund' and delta>0)
 *   2. Multi-tenant isolation: a different user's rows are NOT
 *      counted.
 *   3. Range filtering by `created_at`: rows outside `[from, to)`
 *      are excluded.
 *   4. Guard conditions:
 *        - `send` rows with delta >= 0 are ignored (only debits
 *          count as spend).
 *        - `purchase` rows with delta <= 0 are ignored (refund-
 *          paired credits are not counted as purchases).
 *        - `refund` rows with delta <= 0 are ignored.
 *        - Other reasons (`bonus`, `admin_adjust`, etc.) are
 *          ignored entirely.
 *   5. Empty case: returns all zeros.
 *   6. Validation: non-positive `userId` throws.
 *   7. Default range covers the last 30 days.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/db";
import { getCostSummary, type ReportRange } from "@/lib/reports-cost";

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(db: TestDb, id: number): Promise<void> {
  await db.insert("users", {
    id,
    email: `u${id}@example.com`,
    password_hash: "x",
    name: `User ${id}`,
  });
}

interface SeedTxnArgs {
  id: number;
  userId: number;
  delta: number;
  reason:
    | "purchase"
    | "send"
    | "refund"
    | "bonus"
    | "admin_adjust";
  createdAt: Date;
}

async function seedTxn(db: TestDb, args: SeedTxnArgs): Promise<void> {
  await db.insert("credit_transactions", {
    id: args.id,
    user_id: args.userId,
    delta: args.delta,
    reason: args.reason,
    created_at: args.createdAt,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("getCostSummary (US-017)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1);
  });

  it("returns all zeros when the user has no transactions", async () => {
    const summary = await getCostSummary(1, {}, db);
    expect(summary).toEqual({
      totalSpent: 0,
      totalPurchased: 0,
      totalRefunds: 0,
    });
  });

  it("sums send / purchase / refund deltas correctly", async () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    // Spend: two sends of -3 and -5 = -8 → totalSpent = 8.
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -3,
      reason: "send",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: -5,
      reason: "send",
      createdAt: at,
    });
    // Purchases: 100 + 500 = 600.
    await seedTxn(db, {
      id: 3,
      userId: 1,
      delta: 100,
      reason: "purchase",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 4,
      userId: 1,
      delta: 500,
      reason: "purchase",
      createdAt: at,
    });
    // Refund: 50.
    await seedTxn(db, {
      id: 5,
      userId: 1,
      delta: 50,
      reason: "refund",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalSpent).toBe(8);
    expect(summary.totalPurchased).toBe(600);
    expect(summary.totalRefunds).toBe(50);
  });

  it("does NOT include another user's transactions", async () => {
    await seedUser(db, 2);
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -10,
      reason: "send",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 200,
      reason: "purchase",
      createdAt: at,
    });
    // User 2's row — should be excluded entirely.
    await seedTxn(db, {
      id: 99,
      userId: 2,
      delta: -999,
      reason: "send",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 100,
      userId: 2,
      delta: 9999,
      reason: "purchase",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalSpent).toBe(10);
    expect(summary.totalPurchased).toBe(200);
    expect(summary.totalRefunds).toBe(0);
  });

  it("filters by created_at — rows outside [from, to) are excluded", async () => {
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -10,
      reason: "send",
      createdAt: new Date("2026-06-10T12:00:00.000Z"), // outside
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: -20,
      reason: "send",
      createdAt: new Date("2026-06-15T12:00:00.000Z"), // inside
    });
    await seedTxn(db, {
      id: 3,
      userId: 1,
      delta: -30,
      reason: "send",
      createdAt: new Date("2026-06-20T12:00:00.000Z"), // outside
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalSpent).toBe(20);
  });

  it("ignores send rows with delta >= 0 (only debits count as spend)", async () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -5,
      reason: "send",
      createdAt: at,
    });
    // +5 send — should be ignored (positive delta, not a debit).
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 5,
      reason: "send",
      createdAt: at,
    });
    // Zero send — should be ignored.
    await seedTxn(db, {
      id: 3,
      userId: 1,
      delta: 0,
      reason: "send",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalSpent).toBe(5);
  });

  it("ignores purchase rows with delta <= 0 (refund-paired credits are not purchases)", async () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: 100,
      reason: "purchase",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: -100,
      reason: "purchase",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 3,
      userId: 1,
      delta: 0,
      reason: "purchase",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalPurchased).toBe(100);
  });

  it("ignores refund rows with delta <= 0", async () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: 50,
      reason: "refund",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: -50,
      reason: "refund",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    expect(summary.totalRefunds).toBe(50);
  });

  it("ignores bonus + admin_adjust rows entirely", async () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: 25,
      reason: "bonus",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 25,
      reason: "admin_adjust",
      createdAt: at,
    });
    await seedTxn(db, {
      id: 3,
      userId: 1,
      delta: -3,
      reason: "send",
      createdAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const summary = await getCostSummary(1, range, db);
    // Only the send row contributes.
    expect(summary.totalSpent).toBe(3);
    expect(summary.totalPurchased).toBe(0);
    expect(summary.totalRefunds).toBe(0);
  });

  it("default range covers the last 30 days", async () => {
    const now = Date.now();
    const recent = new Date(now - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const tooOld = new Date(now - 31 * 24 * 60 * 60 * 1000); // 31 days ago
    await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -7,
      reason: "send",
      createdAt: recent,
    });
    await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: -99,
      reason: "send",
      createdAt: tooOld,
    });

    const summary = await getCostSummary(1, {}, db);
    expect(summary.totalSpent).toBe(7);
  });

  it("throws on non-positive userId", async () => {
    await expect(getCostSummary(0, {}, db)).rejects.toThrow(/invalid userId/);
    await expect(getCostSummary(-1, {}, db)).rejects.toThrow(/invalid userId/);
    await expect(
      getCostSummary(1.5 as unknown as number, {}, db),
    ).rejects.toThrow(/invalid userId/);
  });
});