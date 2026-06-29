import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
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
import {
  __markAllReadInternal,
  __markReadInternal,
  markAllReadAction,
  markReadAction,
} from "@/lib/actions/inbox";
import { getDashboardStats } from "@/lib/dashboard";

/**
 * Inbox action tests.
 *
 * Coverage:
 *   - `__markReadInternal`: happy-path flips a single row, refuses
 *     missing rows, refuses cross-user rows (with the same error
 *     shape — no existence leak), refuses non-positive ids, is
 *     idempotent on already-read rows.
 *   - `__markAllReadInternal`: flips every unread row, refuses
 *     non-positive userId, is a no-op when everything is already
 *     read, drops the dashboard unread count to zero.
 *   - Public actions (`markReadAction` / `markAllReadAction`): route
 *     through `requireUser` + the singleton, reject when no user is
 *     resolved.
 *   - Dashboard unread count verification: after marking all read,
 *     `getDashboardStats(userId).unread` returns 0.
 *
 * Mirrors the `__<name>Internal` split used by every other action
 * file in this codebase (US-006 onward).
 */

interface SeedInboundArgs {
  userId: number;
  fromPhone: string;
  body: string;
  read?: boolean;
}

async function seedInbound(db: TestDb, args: SeedInboundArgs): Promise<number> {
  const inserted = await db.insert("inbound_messages", {
    user_id: args.userId,
    from_phone: args.fromPhone,
    to_number: "+15550000001",
    body: args.body,
    twilio_message_sid: `SM_${Math.random().toString(36).slice(2, 10)}`,
    read: args.read ?? false,
  });
  return inserted.id as number;
}

describe("inbox actions", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  // --------------------------------------------------------------------------
  // __markReadInternal
  // --------------------------------------------------------------------------

  describe("__markReadInternal", () => {
    it("flips a single unread row to read=true", async () => {
      const db = createTestDb();
      const id = await seedInbound(db, {
        userId: 1,
        fromPhone: "+15551234567",
        body: "hi",
      });

      await __markReadInternal({ userId: 1, id, db });

      const after = await db.select("inbound_messages", { id });
      expect(after[0]?.read).toBe(true);
    });

    it("throws when the row does not exist", async () => {
      const db = createTestDb();
      await expect(
        __markReadInternal({ userId: 1, id: 999, db }),
      ).rejects.toThrow(/not found/i);
    });

    it("throws when the row belongs to another user (same error shape)", async () => {
      const db = createTestDb();
      const id = await seedInbound(db, {
        userId: 2,
        fromPhone: "+15551234567",
        body: "private",
      });
      // User 1 trying to mark user 2's row as read.
      await expect(
        __markReadInternal({ userId: 1, id, db }),
      ).rejects.toThrow(/not found/i);

      // Original row is untouched.
      const after = await db.select("inbound_messages", { id });
      expect(after[0]?.read).toBe(false);
    });

    it("refuses non-positive userId", async () => {
      const db = createTestDb();
      await expect(
        __markReadInternal({ userId: 0, id: 1, db }),
      ).rejects.toThrow(/userId/i);
    });

    it("refuses non-positive id", async () => {
      const db = createTestDb();
      await expect(
        __markReadInternal({ userId: 1, id: 0, db }),
      ).rejects.toThrow(/id/i);
    });

    it("is idempotent on already-read rows", async () => {
      const db = createTestDb();
      const id = await seedInbound(db, {
        userId: 1,
        fromPhone: "+15551234567",
        body: "already read",
        read: true,
      });
      // Should not throw — flipping a true flag to true is a no-op.
      const result = await __markReadInternal({ userId: 1, id, db });
      expect(result).toEqual({ id });

      const after = await db.select("inbound_messages", { id });
      expect(after[0]?.read).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // __markAllReadInternal
  // --------------------------------------------------------------------------

  describe("__markAllReadInternal", () => {
    it("flips every unread row for the current user to read=true", async () => {
      const db = createTestDb();
      await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
      await seedInbound(db, { userId: 1, fromPhone: "+15552222222", body: "b" });
      await seedInbound(db, { userId: 1, fromPhone: "+15553333333", body: "c" });

      const result = await __markAllReadInternal({ userId: 1, db });
      expect(result.updated).toBe(3);

      const after = await db.select("inbound_messages", { user_id: 1 });
      expect(after.every((r) => r.read === true)).toBe(true);
    });

    it("does not touch rows belonging to other users", async () => {
      const db = createTestDb();
      await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
      await seedInbound(db, { userId: 2, fromPhone: "+15552222222", body: "b" });

      const result = await __markAllReadInternal({ userId: 1, db });
      expect(result.updated).toBe(1);

      const user2 = await db.select("inbound_messages", { user_id: 2 });
      expect(user2[0]?.read).toBe(false);
    });

    it("returns updated=0 when every row is already read", async () => {
      const db = createTestDb();
      await seedInbound(db, {
        userId: 1,
        fromPhone: "+15551111111",
        body: "a",
        read: true,
      });
      await seedInbound(db, {
        userId: 1,
        fromPhone: "+15552222222",
        body: "b",
        read: true,
      });

      const result = await __markAllReadInternal({ userId: 1, db });
      expect(result.updated).toBe(0);
    });

    it("refuses non-positive userId", async () => {
      const db = createTestDb();
      await expect(
        __markAllReadInternal({ userId: -1, db }),
      ).rejects.toThrow(/userId/i);
    });

    it("is idempotent — second call returns updated=0", async () => {
      const db = createTestDb();
      await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });

      const first = await __markAllReadInternal({ userId: 1, db });
      expect(first.updated).toBe(1);
      const second = await __markAllReadInternal({ userId: 1, db });
      expect(second.updated).toBe(0);
    });

    it("drops the dashboard unread count to 0 after marking all read", async () => {
      // Use the singleton so getDashboardStats reads the same data.
      const db = getTestDb();
      await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
      await seedInbound(db, { userId: 1, fromPhone: "+15552222222", body: "b" });
      await seedInbound(db, { userId: 1, fromPhone: "+15553333333", body: "c" });

      const before = await getDashboardStats(1, db);
      expect(before.unread).toBe(3);

      await __markAllReadInternal({ userId: 1, db });

      const after = await getDashboardStats(1, db);
      expect(after.unread).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Public actions — singleton + requireUser routing
  // --------------------------------------------------------------------------

  describe("public actions", () => {
    beforeEach(async () => {
      // Seed via the singleton so the public actions' `getTestDb()`
      // calls see user 1.
      const db = getTestDb();
      await db.insert("users", {
        id: 1,
        email: "alice@example.com",
        password_hash: "x",
        name: "Alice",
        twilio_from_number: "+15550000001",
      });
    });

    it("markReadAction routes through the singleton + requireUser", async () => {
      // Seed via the singleton — the public action reads through it.
      const db = getTestDb();
      const id = await seedInbound(db, {
        userId: 1,
        fromPhone: "+15551111111",
        body: "hi",
      });
      __setCurrentUserIdForTests(1);

      const result = await markReadAction({ id });
      expect(result).toEqual({ id });

      const after = await db.select("inbound_messages", { id });
      expect(after[0]?.read).toBe(true);
    });

    it("markReadAction rejects when no user is authenticated (via requireUser override to a non-existent id)", async () => {
      // Mirror the schedule.test.ts pattern: set the override to 0 so
      // requireUser() hits the "user not found" branch. The
      // "no cookie + no override" path can't be exercised here
      // because `cookies()` from `next/headers` throws when called
      // outside a request scope (jsdom test env). Test that path
      // through the action internals instead.
      __setCurrentUserIdForTests(0);
      await expect(markReadAction({ id: 1 })).rejects.toThrow(
        /Unauthorized.*not found/i,
      );
    });

    it("markAllReadAction routes through the singleton + requireUser", async () => {
      const db = getTestDb();
      await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
      await seedInbound(db, { userId: 1, fromPhone: "+15552222222", body: "b" });
      __setCurrentUserIdForTests(1);

      const result = await markAllReadAction();
      expect(result.updated).toBe(2);

      const after = await db.select("inbound_messages", { user_id: 1 });
      expect(after.every((r) => r.read === true)).toBe(true);

      // Dashboard unread count is now 0.
      const stats = await getDashboardStats(1, db);
      expect(stats.unread).toBe(0);
    });

    it("markAllReadAction rejects when no user is authenticated (via requireUser override to a non-existent id)", async () => {
      __setCurrentUserIdForTests(0);
      await expect(markAllReadAction()).rejects.toThrow(
        /Unauthorized.*not found/i,
      );
    });
  });
});