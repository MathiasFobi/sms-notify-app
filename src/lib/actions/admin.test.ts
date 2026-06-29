import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __adminAdjustCreditsInternal,
  __adminListUsersInternal,
  adminAdjustCreditsAction,
  adminListUsersAction,
  type AdminUserRow,
} from "@/lib/actions/admin";
import {
  ADMIN_ADJUST_REASONS,
} from "@/lib/admin/reasons";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Tests for the admin actions (US-019).
 *
 * Two-layer coverage, mirroring every other action file in the repo:
 *
 *   1. `__<name>Internal` is exercised directly with a fresh
 *      `createTestDb()` — keeps tests hermetic and lets us
 *      assert on cross-user safety without going through
 *      `requireAdmin()`.
 *
 *   2. The public actions are exercised through the singleton DB +
 *      `__setCurrentUserIdForTests()` override — this verifies the
 *      `requireAdmin()` auth-gating layer.
 *
 *   3. The auth-gating itself is verified by flipping the override
 *      to a non-admin user and asserting `notFound()` (a thrown
 *      error) surfaces.
 */

// ============================================================================
// Seed helpers
// ============================================================================

async function seedUser(
  db: TestDb,
  args: {
    id: number;
    email?: string;
    name?: string;
    role?: "user" | "admin";
    createdAt?: Date;
  },
): Promise<void> {
  await db.insert("users", {
    id: args.id,
    email: args.email ?? `u${args.id}@example.com`,
    password_hash: "x",
    name: args.name ?? `User ${args.id}`,
    role: args.role ?? "user",
    created_at: args.createdAt,
  });
}

async function seedAccount(
  db: TestDb,
  userId: number,
  credits: number,
): Promise<void> {
  await db.insert("accounts", {
    user_id: userId,
    credits,
  });
}

// ===========================================================================
// __adminListUsersInternal — directly testable with a fresh TestDb.
// ===========================================================================

describe("__adminListUsersInternal()", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns an empty list when no users exist", async () => {
    const result = await __adminListUsersInternal({ db });
    expect(result.users).toEqual([]);
  });

  it("returns every user with credits defaulted to 0 when no account row exists", async () => {
    await seedUser(db, { id: 1, email: "a@x.com", name: "Alice" });
    await seedUser(db, { id: 2, email: "b@x.com", name: "Bob" });

    const result = await __adminListUsersInternal({ db });
    expect(result.users).toHaveLength(2);
    expect(result.users.map((u) => u.email).sort()).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
    for (const u of result.users) {
      expect(u.credits).toBe(0);
    }
  });

  it("joins accounts.credits onto the user rows", async () => {
    await seedUser(db, { id: 1, email: "a@x.com", name: "Alice" });
    await seedUser(db, { id: 2, email: "b@x.com", name: "Bob" });
    await seedAccount(db, 1, 250);
    await seedAccount(db, 2, 1_000);

    const result = await __adminListUsersInternal({ db });
    const byEmail = new Map(result.users.map((u) => [u.email, u]));
    expect(byEmail.get("a@x.com")?.credits).toBe(250);
    expect(byEmail.get("b@x.com")?.credits).toBe(1_000);
  });

  it("matches query case-insensitively against email OR name", async () => {
    await seedUser(db, { id: 1, email: "alice@example.com", name: "Alice" });
    await seedUser(db, { id: 2, email: "bob@example.com", name: "Robert" });
    await seedUser(db, {
      id: 3,
      email: "carol@example.com",
      // Two words so "alice" matches the NAME (not just the email).
      // Note: "Alicia" wouldn't match the substring "alice" — pick a
      // name where the substring genuinely appears.
      name: "Carol-Ann St. Alice",
    });

    const aliceOnly = await __adminListUsersInternal({
      query: "alice",
      db,
    });
    expect(aliceOnly.users.map((u) => u.email).sort()).toEqual([
      "alice@example.com",
      "carol@example.com",
    ]);

    const exampleOnly = await __adminListUsersInternal({
      query: "@example",
      db,
    });
    expect(exampleOnly.users).toHaveLength(3);
  });

  it("sorts results by created_at descending (newest first)", async () => {
    const oldest = new Date("2026-01-01T00:00:00Z");
    const middle = new Date("2026-03-01T00:00:00Z");
    const newest = new Date("2026-06-15T00:00:00Z");
    await seedUser(db, { id: 1, email: "old@x.com", createdAt: oldest });
    await seedUser(db, { id: 2, email: "new@x.com", createdAt: newest });
    await seedUser(db, { id: 3, email: "mid@x.com", createdAt: middle });

    const result = await __adminListUsersInternal({ db });
    expect(result.users.map((u) => u.email)).toEqual([
      "new@x.com",
      "mid@x.com",
      "old@x.com",
    ]);
  });

  it("caps results to the provided limit (default 100)", async () => {
    for (let i = 1; i <= 5; i++) {
      await seedUser(db, { id: i, email: `u${i}@x.com` });
    }
    const limited = await __adminListUsersInternal({ limit: 2, db });
    expect(limited.users).toHaveLength(2);

    const unlimited = await __adminListUsersInternal({ db });
    expect(unlimited.users).toHaveLength(5);
  });

  it("treats a non-positive limit as the default (100)", async () => {
    await seedUser(db, { id: 1, email: "u1@x.com" });
    const result = await __adminListUsersInternal({ limit: 0, db });
    expect(result.users).toHaveLength(1);
  });

  it("returns rows with the AdminUserRow shape", async () => {
    await seedUser(db, {
      id: 1,
      email: "a@x.com",
      name: "Alice",
      role: "admin",
    });
    await seedAccount(db, 1, 42);

    const result = await __adminListUsersInternal({ db });
    const row: AdminUserRow = result.users[0]!;
    expect(row).toEqual({
      id: 1,
      email: "a@x.com",
      name: "Alice",
      role: "admin",
      credits: 42,
      createdAt: expect.any(Date),
    });
  });
});

// ===========================================================================
// __adminAdjustCreditsInternal — directly testable with a fresh TestDb.
// ===========================================================================

describe("__adminAdjustCreditsInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, { id: 1, email: "target@x.com", name: "Target" });
    await seedAccount(db, 1, 100);
  });

  it("adds delta to accounts.credits", async () => {
    const result = await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 50,
      reason: "support",
      db,
    });
    expect(result.credits).toBe(150);

    const accounts = await db.select("accounts", { user_id: 1 });
    expect(accounts[0]!.credits).toBe(150);
  });

  it("supports negative deltas (debits)", async () => {
    const result = await __adminAdjustCreditsInternal({
      userId: 1,
      delta: -25,
      reason: "correction",
      db,
    });
    expect(result.credits).toBe(75);
  });

  it("allows delta=0 (no-op but still writes an audit row)", async () => {
    const result = await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 0,
      reason: "support",
      db,
    });
    expect(result.credits).toBe(100);

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.delta).toBe(0);
  });

  it("writes a credit_transactions row with reason='admin_adjust'", async () => {
    await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 10,
      reason: "refund",
      db,
    });

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.reason).toBe("admin_adjust");
    expect(txns[0]!.delta).toBe(10);
  });

  it("encodes the operator's chosen reason into stripe_payment_intent_id", async () => {
    await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 5,
      reason: "goodwill",
      db,
    });

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns[0]!.stripe_payment_intent_id).toBe("admin_adjust:goodwill");
  });

  it("returns the inserted credit_transactions.id", async () => {
    const result = await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 5,
      reason: "support",
      db,
    });
    expect(typeof result.txnId).toBe("number");
    expect(result.txnId).toBeGreaterThan(0);
  });

  it("throws on non-positive userId", async () => {
    await expect(
      __adminAdjustCreditsInternal({
        userId: 0,
        delta: 10,
        reason: "support",
        db,
      }),
    ).rejects.toThrow(/userId/);

    await expect(
      __adminAdjustCreditsInternal({
        userId: -1,
        delta: 10,
        reason: "support",
        db,
      }),
    ).rejects.toThrow(/userId/);
  });

  it("throws on non-integer delta", async () => {
    await expect(
      __adminAdjustCreditsInternal({
        userId: 1,
        delta: 1.5 as unknown as number,
        reason: "support",
        db,
      }),
    ).rejects.toThrow(/delta/);
  });

  it("throws on an unknown reason", async () => {
    await expect(
      __adminAdjustCreditsInternal({
        userId: 1,
        delta: 10,
        reason: "because-i-said-so",
        db,
      }),
    ).rejects.toThrow(/reason/);
  });

  it("throws when the target user does not exist", async () => {
    await expect(
      __adminAdjustCreditsInternal({
        userId: 999,
        delta: 10,
        reason: "support",
        db,
      }),
    ).rejects.toThrow(/user 999 not found/);
  });

  it("throws when the target user has no account row", async () => {
    await seedUser(db, { id: 2, email: "noaccount@x.com" });
    // Note: no seedAccount for user 2.
    await expect(
      __adminAdjustCreditsInternal({
        userId: 2,
        delta: 10,
        reason: "support",
        db,
      }),
    ).rejects.toThrow(/no account row for user 2/);
  });

  it("accumulates across multiple adjustments", async () => {
    await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 10,
      reason: "support",
      db,
    });
    await __adminAdjustCreditsInternal({
      userId: 1,
      delta: -5,
      reason: "correction",
      db,
    });
    await __adminAdjustCreditsInternal({
      userId: 1,
      delta: 1_000,
      reason: "goodwill",
      db,
    });

    const accounts = await db.select("accounts", { user_id: 1 });
    expect(accounts[0]!.credits).toBe(1_105);

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(3);
    expect(txns.map((t) => t.delta)).toEqual([10, -5, 1_000]);
    expect(txns.map((t) => t.stripe_payment_intent_id)).toEqual([
      "admin_adjust:support",
      "admin_adjust:correction",
      "admin_adjust:goodwill",
    ]);
  });

  it("exports every allowed reason on ADMIN_ADJUST_REASONS", () => {
    expect(ADMIN_ADJUST_REASONS).toEqual([
      "support",
      "refund",
      "goodwill",
      "correction",
      "chargeback",
    ]);
  });
});

// ===========================================================================
// adminListUsersAction — auth-gated public action.
// ===========================================================================

describe("adminListUsersAction() (public)", () => {
  let db: TestDb;

  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
  });

  it("returns the list when the current user is an admin", async () => {
    await seedUser(db, { id: 1, role: "admin", email: "root@x.com" });
    await seedUser(db, { id: 2, role: "user", email: "alice@x.com" });
    await seedAccount(db, 2, 50);

    __setCurrentUserIdForTests(1);

    const result = await adminListUsersAction({});
    expect(result.users).toHaveLength(2);
  });

  it("throws notFound() when the current user is a non-admin", async () => {
    await seedUser(db, { id: 1, role: "user" });
    __setCurrentUserIdForTests(1);

    await expect(adminListUsersAction({})).rejects.toThrow();
  });

  it("passes query through to the internal helper", async () => {
    await seedUser(db, { id: 1, role: "admin" });
    await seedUser(db, { id: 2, role: "user", email: "alice@x.com" });
    await seedUser(db, { id: 3, role: "user", email: "bob@x.com" });

    __setCurrentUserIdForTests(1);

    const result = await adminListUsersAction({ query: "alice" });
    expect(result.users).toHaveLength(1);
    expect(result.users[0]!.email).toBe("alice@x.com");
  });
});

// ===========================================================================
// adminAdjustCreditsAction — auth-gated public action.
// ===========================================================================

describe("adminAdjustCreditsAction() (public)", () => {
  let db: TestDb;

  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await seedUser(db, { id: 1, role: "admin" });
    await seedUser(db, { id: 2, role: "user", email: "alice@x.com" });
    await seedAccount(db, 2, 100);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
  });

  it("adjusts credits when the current user is an admin", async () => {
    __setCurrentUserIdForTests(1);

    const result = await adminAdjustCreditsAction({
      userId: 2,
      delta: 25,
      reason: "support",
    });
    expect(result.credits).toBe(125);

    const txns = await db.select("credit_transactions", { user_id: 2 });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.reason).toBe("admin_adjust");
  });

  it("throws notFound() when the current user is a non-admin", async () => {
    __setCurrentUserIdForTests(2);

    await expect(
      adminAdjustCreditsAction({ userId: 2, delta: 10, reason: "support" }),
    ).rejects.toThrow();

    // No audit row should be written for the rejected call.
    const txns = await db.select("credit_transactions", { user_id: 2 });
    expect(txns).toHaveLength(0);
  });

  it("throws when the target user does not exist", async () => {
    __setCurrentUserIdForTests(1);

    await expect(
      adminAdjustCreditsAction({ userId: 999, delta: 10, reason: "support" }),
    ).rejects.toThrow(/user 999 not found/);
  });

  it("throws on an unknown reason", async () => {
    __setCurrentUserIdForTests(1);

    await expect(
      adminAdjustCreditsAction({
        userId: 2,
        delta: 10,
        reason: "anything-goes",
      }),
    ).rejects.toThrow(/reason/);

    // Credits untouched.
    const accounts = await db.select("accounts", { user_id: 2 });
    expect(accounts[0]!.credits).toBe(100);
  });
});