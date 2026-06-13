import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users, accounts, messages, inboundMessages } from "@/db/schema";
import { hashPassword } from "@/lib/password";
import type { TestDb } from "@/test/db";
import { createTestDb } from "@/test/db";

/**
 * US-003 dashboard stats helper tests.
 *
 * `getDashboardStats(userId, db)` is the source of truth for
 * the four stat cards on /app/dashboard. We exercise it
 * against an in-memory PGlite DB:
 *
 *  - empty case (no data) — all counts must be 0, credits 0
 *  - credits row, no messages
 *  - 30-day window: rows older than 30 days are not counted
 *  - scheduled count: only status='scheduled' rows
 *  - unread count: only read=false rows
 *
 * The test mocks `@/db` so the helper uses our PGlite
 * instance, mirroring the pattern in the other auth tests.
 */

let T: Awaited<ReturnType<typeof createTestDb>>;
const testState: { dbRef: TestDb | null } = { dbRef: null };

vi.mock("@/db", () => ({
  get db() {
    return testState.dbRef!;
  },
}));

beforeEach(async () => {
  T = await createTestDb();
  testState.dbRef = T.db;
});

afterEach(async () => {
  try {
    await T.close();
  } catch {
    // already closed
  }
  testState.dbRef = null;
  vi.clearAllMocks();
});

async function seedUserWithAccount(
  credits: number,
): Promise<{ userId: number }> {
  const passwordHash = await hashPassword("correct-horse-battery");
  const [u] = await T.db
    .insert(users)
    .values({
      email: "alice@example.com",
      name: "Alice",
      passwordHash,
      emailVerified: new Date(),
    })
    .returning({ id: users.id });
  await T.db.insert(accounts).values({ userId: u.id, credits });
  return { userId: u.id };
}

describe("getDashboardStats (US-003)", () => {
  it("returns zeros for a brand-new user (no data)", async () => {
    const { userId } = await seedUserWithAccount(0);
    const { getDashboardStats } = await import("@/lib/dashboard");
    const stats = await getDashboardStats(userId);
    expect(stats).toEqual({
      credits: 0,
      messages30d: 0,
      scheduled: 0,
      unread: 0,
    });
  });

  it("reports the credit balance from accounts.credits", async () => {
    const { userId } = await seedUserWithAccount(1250);
    const { getDashboardStats } = await import("@/lib/dashboard");
    const stats = await getDashboardStats(userId);
    expect(stats.credits).toBe(1250);
  });

  it("counts only messages created within the last 30 days", async () => {
    const { userId } = await seedUserWithAccount(0);
    const now = new Date();
    const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    // 1 message older than 30 days (must NOT count)
    await T.db.insert(messages).values({
      userId,
      body: "old",
      fromNumber: "+10000000000",
      status: "sent",
      createdAt: fortyDaysAgo,
    });
    // 2 messages within 30 days (must count)
    await T.db.insert(messages).values([
      {
        userId,
        body: "new-1",
        fromNumber: "+10000000000",
        status: "sent",
        createdAt: fiveDaysAgo,
      },
      {
        userId,
        body: "new-2",
        fromNumber: "+10000000000",
        status: "delivered",
        createdAt: now,
      },
    ]);

    const { getDashboardStats } = await import("@/lib/dashboard");
    const stats = await getDashboardStats(userId);
    expect(stats.messages30d).toBe(2);
  });

  it("counts scheduled messages (status='scheduled') separately", async () => {
    const { userId } = await seedUserWithAccount(0);
    await T.db.insert(messages).values([
      { userId, body: "a", fromNumber: "+10000000000", status: "sent" },
      { userId, body: "b", fromNumber: "+10000000000", status: "delivered" },
      { userId, body: "c", fromNumber: "+10000000000", status: "scheduled" },
      { userId, body: "d", fromNumber: "+10000000000", status: "scheduled" },
    ]);

    const { getDashboardStats } = await import("@/lib/dashboard");
    const stats = await getDashboardStats(userId);
    // All four rows were created "now", so messages30d is 4
    // (we're not asserting that here — focus on the scheduled
    // count).
    expect(stats.scheduled).toBe(2);
  });

  it("counts only unread inbound messages", async () => {
    const { userId } = await seedUserWithAccount(0);
    await T.db.insert(inboundMessages).values([
      {
        userId,
        fromPhone: "+10000000001",
        toNumber: "+10000000000",
        body: "unread-1",
        twilioMessageSid: "SM1",
      },
      {
        userId,
        fromPhone: "+10000000002",
        toNumber: "+10000000000",
        body: "unread-2",
        twilioMessageSid: "SM2",
      },
      {
        userId,
        fromPhone: "+10000000003",
        toNumber: "+10000000000",
        body: "already-read",
        twilioMessageSid: "SM3",
        read: true,
      },
    ]);

    const { getDashboardStats } = await import("@/lib/dashboard");
    const stats = await getDashboardStats(userId);
    expect(stats.unread).toBe(2);
  });

  it("does not include other users' data (multi-tenant isolation)", async () => {
    const { userId: aliceId } = await seedUserWithAccount(100);
    // Bob — different user, different account.
    const bobHash = await hashPassword("another-horse-stable");
    const [bob] = await T.db
      .insert(users)
      .values({
        email: "bob@example.com",
        name: "Bob",
        passwordHash: bobHash,
        emailVerified: new Date(),
      })
      .returning({ id: users.id });
    await T.db.insert(accounts).values({ userId: bob.id, credits: 999 });
    await T.db.insert(inboundMessages).values({
      userId: bob.id,
      fromPhone: "+19999999999",
      toNumber: "+10000000000",
      body: "bob only",
      twilioMessageSid: "SM_BOB_1",
    });

    const { getDashboardStats } = await import("@/lib/dashboard");
    const aliceStats = await getDashboardStats(aliceId);
    expect(aliceStats.credits).toBe(100);
    expect(aliceStats.unread).toBe(0);
  });
});
