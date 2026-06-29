/**
 * Tests for `src/lib/reports.ts` (US-017).
 *
 * Coverage:
 *
 *   1. `getDeliveryReport()` returns counts that match a direct
 *      DB query of the same window.
 *   2. Multi-tenant isolation: a different user's messages in the
 *      same window are NOT included in the totals or the
 *      `perMessage` array.
 *   3. Range filtering by `sent_at`: rows outside `[from, to)` are
 *      excluded. Rows with `sent_at = null` (scheduled / cancelled)
 *      are excluded too.
 *   4. Per-message roll-up: `recipientCount`, `deliveredCount`,
 *      `failedCount`, and `deliveredAt` (max of recipient
 *      `delivered_at`) are computed correctly.
 *   5. Status counts: `totalSent` includes sent/delivered/failed;
 *      `totalDelivered` and `totalFailed` only match the literal
 *      statuses.
 *   6. Empty case: no messages → all zeros + empty array.
 *   7. Validation: non-positive `userId` throws.
 *   8. Default range: when no `range` is provided, the helper uses
 *      a 30-day window that INCLUDES recent messages.
 *   9. Newest-first sort: `perMessage` is sorted by `sentAt` desc.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb, type TestRow } from "@/test/db";
import { getDeliveryReport, type ReportRange } from "@/lib/reports";

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

interface SeedMessageArgs {
  id: number;
  userId: number;
  body?: string;
  status?: string;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
}

async function seedMessage(db: TestDb, args: SeedMessageArgs): Promise<void> {
  await db.insert("messages", {
    id: args.id,
    user_id: args.userId,
    body: args.body ?? `body-${args.id}`,
    from_number: "+15555550100",
    status: args.status ?? "sent",
    sent_at: args.sentAt ?? null,
    delivered_at: args.deliveredAt ?? null,
  });
}

interface SeedRecipientArgs {
  id: number;
  messageId: number;
  phone?: string;
  status?: string;
  deliveredAt?: Date | null;
}

async function seedRecipient(
  db: TestDb,
  args: SeedRecipientArgs,
): Promise<void> {
  await db.insert("message_recipients", {
    id: args.id,
    message_id: args.messageId,
    phone: args.phone ?? `+15555550${String(args.id).padStart(4, "0")}`,
    status: args.status ?? "sent",
    delivered_at: args.deliveredAt ?? null,
  });
}

/**
 * Equivalent to the helper's filtering — runs against `db.select`
 * directly so we can assert the helper's totals are EXACTLY the
 * same shape a manual SQL query would produce. Used by the
 * "matches a direct DB query" assertion.
 */
async function directCounts(
  db: TestDb,
  userId: number,
  range: ReportRange,
): Promise<{
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  inWindow: number;
}> {
  const userMessages = await db.select("messages", { user_id: userId });
  const fromMs = (range.from ?? new Date(0)).getTime();
  const toMs = (range.to ?? new Date(Date.now() + 1)).getTime();
  let totalSent = 0;
  let totalDelivered = 0;
  let totalFailed = 0;
  let inWindow = 0;
  for (const m of userMessages) {
    const sentAt = m.sent_at;
    if (!(sentAt instanceof Date)) continue;
    const t = sentAt.getTime();
    if (t < fromMs || t >= toMs) continue;
    inWindow++;
    const status = String(m.status ?? "");
    if (status === "sent" || status === "delivered" || status === "failed") {
      totalSent++;
    }
    if (status === "delivered") totalDelivered++;
    if (status === "failed") totalFailed++;
  }
  return { totalSent, totalDelivered, totalFailed, inWindow };
}

// ============================================================================
// Tests
// ============================================================================

describe("getDeliveryReport (US-017)", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1);
  });

  it("returns all-zero counts and an empty array when the user has no messages", async () => {
    const report = await getDeliveryReport(1, {}, db);
    expect(report).toEqual({
      totalSent: 0,
      totalDelivered: 0,
      totalFailed: 0,
      perMessage: [],
    });
  });

  it("counts match a direct DB query over the same window", async () => {
    // Seed a realistic spread: 5 messages, varying statuses + sent_at.
    const base = new Date("2026-06-15T12:00:00.000Z");
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "delivered",
      sentAt: new Date(base.getTime() + 1 * 60 * 60 * 1000), // +1h
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "delivered",
      sentAt: new Date(base.getTime() + 2 * 60 * 60 * 1000),
    });
    await seedMessage(db, {
      id: 3,
      userId: 1,
      status: "failed",
      sentAt: new Date(base.getTime() + 3 * 60 * 60 * 1000),
    });
    await seedMessage(db, {
      id: 4,
      userId: 1,
      status: "sent",
      sentAt: new Date(base.getTime() + 4 * 60 * 60 * 1000),
    });
    // Scheduled (no sent_at) — should NOT count.
    await seedMessage(db, { id: 5, userId: 1, status: "scheduled" });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);
    const direct = await directCounts(db, 1, range);

    expect(report.totalSent).toBe(direct.totalSent);
    expect(report.totalDelivered).toBe(direct.totalDelivered);
    expect(report.totalFailed).toBe(direct.totalFailed);
    expect(report.totalSent).toBe(4); // delivered, delivered, failed, sent
    expect(report.totalDelivered).toBe(2);
    expect(report.totalFailed).toBe(1);
    expect(report.perMessage).toHaveLength(direct.inWindow);
  });

  it("does NOT include another user's messages in the totals or perMessage array", async () => {
    await seedUser(db, 2);
    const at = new Date("2026-06-15T12:00:00.000Z");
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "delivered",
      sentAt: at,
    });
    await seedMessage(db, {
      id: 2,
      userId: 2,
      status: "delivered",
      sentAt: at,
    });
    await seedMessage(db, {
      id: 3,
      userId: 2,
      status: "failed",
      sentAt: at,
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);

    expect(report.totalSent).toBe(1);
    expect(report.totalDelivered).toBe(1);
    expect(report.totalFailed).toBe(0);
    expect(report.perMessage).toHaveLength(1);
    expect(report.perMessage[0]!.id).toBe(1);
  });

  it("filters by sent_at — rows outside [from, to) are excluded", async () => {
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-10T12:00:00.000Z"), // outside
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-15T12:00:00.000Z"), // inside
    });
    await seedMessage(db, {
      id: 3,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-20T12:00:00.000Z"), // outside
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);

    expect(report.perMessage).toHaveLength(1);
    expect(report.perMessage[0]!.id).toBe(2);
    expect(report.totalSent).toBe(1);
  });

  it("excludes rows with sent_at = null (scheduled / cancelled)", async () => {
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "scheduled",
      sentAt: null,
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "cancelled",
      sentAt: null,
    });
    const report = await getDeliveryReport(1, {}, db);
    expect(report.totalSent).toBe(0);
    expect(report.perMessage).toEqual([]);
  });

  it("rolls up recipient counts per message: recipientCount, deliveredCount, failedCount", async () => {
    await seedMessage(db, {
      id: 10,
      userId: 1,
      status: "delivered",
      sentAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    // 5 recipients: 3 delivered, 1 failed, 1 sent.
    await seedRecipient(db, {
      id: 1,
      messageId: 10,
      status: "delivered",
      deliveredAt: new Date("2026-06-15T12:01:00.000Z"),
    });
    await seedRecipient(db, {
      id: 2,
      messageId: 10,
      status: "delivered",
      deliveredAt: new Date("2026-06-15T12:02:00.000Z"),
    });
    await seedRecipient(db, {
      id: 3,
      messageId: 10,
      status: "delivered",
      deliveredAt: new Date("2026-06-15T12:03:00.000Z"),
    });
    await seedRecipient(db, {
      id: 4,
      messageId: 10,
      status: "failed",
    });
    await seedRecipient(db, {
      id: 5,
      messageId: 10,
      status: "sent",
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);
    expect(report.perMessage).toHaveLength(1);
    const row = report.perMessage[0]!;
    expect(row.recipientCount).toBe(5);
    expect(row.deliveredCount).toBe(3);
    expect(row.failedCount).toBe(1);
    // deliveredAt = max of recipient.delivered_at (12:03:00).
    expect(row.deliveredAt?.toISOString()).toBe(
      new Date("2026-06-15T12:03:00.000Z").toISOString(),
    );
  });

  it("perMessage[].deliveredAt is null when no recipient has delivered_at set", async () => {
    await seedMessage(db, {
      id: 20,
      userId: 1,
      status: "failed",
      sentAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    await seedRecipient(db, {
      id: 1,
      messageId: 20,
      status: "failed",
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);
    expect(report.perMessage[0]!.deliveredAt).toBeNull();
  });

  it("sorts perMessage newest-first by sentAt", async () => {
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-15T08:00:00.000Z"),
    });
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    await seedMessage(db, {
      id: 3,
      userId: 1,
      status: "sent",
      sentAt: new Date("2026-06-15T10:00:00.000Z"),
    });

    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);
    expect(report.perMessage.map((m) => m.id)).toEqual([2, 3, 1]);
  });

  it("default range covers the last 30 days (recent messages are included)", async () => {
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    await seedMessage(db, {
      id: 1,
      userId: 1,
      status: "sent",
      sentAt: oneDayAgo,
    });
    // 31 days ago — should be EXCLUDED by the default 30-day window.
    const thirtyOneDaysAgo = new Date(now - 31 * 24 * 60 * 60 * 1000);
    await seedMessage(db, {
      id: 2,
      userId: 1,
      status: "sent",
      sentAt: thirtyOneDaysAgo,
    });

    const report = await getDeliveryReport(1, {}, db);
    expect(report.perMessage).toHaveLength(1);
    expect(report.perMessage[0]!.id).toBe(1);
  });

  it("throws on non-positive userId", async () => {
    await expect(getDeliveryReport(0, {}, db)).rejects.toThrow(/invalid userId/);
    await expect(getDeliveryReport(-1, {}, db)).rejects.toThrow(/invalid userId/);
    await expect(
      getDeliveryReport(1.5 as unknown as number, {}, db),
    ).rejects.toThrow(/invalid userId/);
  });

  it("perMessage carries the original body and status verbatim", async () => {
    await seedMessage(db, {
      id: 1,
      userId: 1,
      body: "Hello, world!",
      status: "delivered",
      sentAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const range: ReportRange = {
      from: new Date("2026-06-15T00:00:00.000Z"),
      to: new Date("2026-06-16T00:00:00.000Z"),
    };
    const report = await getDeliveryReport(1, range, db);
    expect(report.perMessage[0]!.body).toBe("Hello, world!");
    expect(report.perMessage[0]!.status).toBe("delivered");
  });
});

// Silence TS unused-import warning for `TestRow` (re-exported via the
// fixture helpers in other test files; harmless here).
void ({} as TestRow);