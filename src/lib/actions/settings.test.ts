import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __updateProfileInternal,
  __updateDefaultSenderIdInternal,
  updateProfileAction,
  updateDefaultSenderIdAction,
} from "@/lib/actions/settings";
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
 * Tests for the Settings actions (US-018).
 *
 * Two-layer coverage, mirroring every other action file in the repo:
 *
 *   1. `__<name>Internal` is exercised directly with a fresh
 *      `createTestDb()` — keeps tests hermetic and lets us
 *      assert on cross-user safety without going through
 *      `requireUser()`.
 *
 *   2. The public actions are exercised through the singleton DB +
 *      `__setCurrentUserIdForTests()` override — this verifies the
 *      auth-gating layer (which is the only difference between
 *      the public action and the internal helper).
 */

// ============================================================================
// Seed helpers
// ============================================================================

async function seedUser(
  db: TestDb,
  args: { id: number; email?: string; name?: string; twilioFromNumber?: string | null },
): Promise<void> {
  await db.insert("users", {
    id: args.id,
    email: args.email ?? `u${args.id}@example.com`,
    password_hash: "x",
    name: args.name ?? `User ${args.id}`,
    twilio_from_number: args.twilioFromNumber ?? null,
  });
}

async function seedApprovedSenderId(
  db: TestDb,
  userId: number,
  value: string,
): Promise<number> {
  const inserted = await db.insert("sender_ids", {
    user_id: userId,
    value,
    status: "approved",
  });
  return inserted.id as number;
}

// ===========================================================================
// __updateProfileInternal — directly testable with a fresh TestDb.
// ===========================================================================

describe("__updateProfileInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, { id: 1, name: "Alice" });
  });

  it("rewrites users.name to the new value", async () => {
    const result = await __updateProfileInternal({
      userId: 1,
      name: "Alice Updated",
      db,
    });
    expect(result.name).toBe("Alice Updated");

    const rows = await db.select("users", { id: 1 });
    expect(rows[0]?.name).toBe("Alice Updated");
  });

  it("trims surrounding whitespace before persisting", async () => {
    const result = await __updateProfileInternal({
      userId: 1,
      name: "  Padded Alice  ",
      db,
    });
    expect(result.name).toBe("Padded Alice");

    const rows = await db.select("users", { id: 1 });
    expect(rows[0]?.name).toBe("Padded Alice");
  });

  it("returns the trimmed value (so the client form can re-sync)", async () => {
    const result = await __updateProfileInternal({
      userId: 1,
      name: "    Trimmed    ",
      db,
    });
    expect(result.name).toBe("Trimmed");
  });

  it("rejects an empty name without writing anything", async () => {
    const before = await db.select("users", { id: 1 });
    expect(before[0]?.name).toBe("Alice");

    await expect(
      __updateProfileInternal({ userId: 1, name: "", db }),
    ).rejects.toThrow(/name is required/i);

    const after = await db.select("users", { id: 1 });
    expect(after[0]?.name).toBe("Alice");
  });

  it("rejects a whitespace-only name without writing anything", async () => {
    await expect(
      __updateProfileInternal({ userId: 1, name: "   \t  ", db }),
    ).rejects.toThrow(/name is required/i);

    const rows = await db.select("users", { id: 1 });
    expect(rows[0]?.name).toBe("Alice");
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __updateProfileInternal({ userId: 0, name: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __updateProfileInternal({ userId: -1, name: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });

  it("rejects a non-string name", async () => {
    await expect(
      // Bypass the type system intentionally — the runtime check
      // exists for robustness against malformed inputs from the
      // server-action transport layer.
      __updateProfileInternal({
        userId: 1,
        name: undefined as unknown as string,
        db,
      }),
    ).rejects.toThrow(/name must be a string/i);
  });

  it("throws when the user does not exist", async () => {
    await expect(
      __updateProfileInternal({ userId: 999, name: "Ghost", db }),
    ).rejects.toThrow(/user 999 not found/i);
  });
});

// ===========================================================================
// __updateDefaultSenderIdInternal — directly testable with a fresh TestDb.
// ===========================================================================

describe("__updateDefaultSenderIdInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, { id: 1, name: "Alice" });
    await seedUser(db, { id: 2, name: "Bob" });
  });

  async function readTwilioFromNumber(
    userId: number,
  ): Promise<string | null | undefined> {
    const rows = await db.select("users", { id: userId });
    const v = rows[0]?.twilio_from_number;
    // The shim returns `undefined` (not `null`) when the column was
    // never set on insert. We surface both shapes back to the test.
    return v === undefined ? undefined : (v as string | null);
  }

  it("writes users.twilioFromNumber for the current user on success", async () => {
    const sid = await seedApprovedSenderId(db, 1, "+15551234567");
    expect(await readTwilioFromNumber(1)).toBeFalsy();

    const result = await __updateDefaultSenderIdInternal({
      userId: 1,
      senderId: sid,
      db,
    });
    expect(result.twilioFromNumber).toBe("+15551234567");
    expect(await readTwilioFromNumber(1)).toBe("+15551234567");
  });

  it("clears users.twilioFromNumber when senderId is null", async () => {
    // Pre-set the default so we can confirm it gets cleared.
    await db.update("users", { id: 1 }, { twilio_from_number: "+15559999999" });
    expect(await readTwilioFromNumber(1)).toBe("+15559999999");

    const result = await __updateDefaultSenderIdInternal({
      userId: 1,
      senderId: null,
      db,
    });
    expect(result.twilioFromNumber).toBeNull();

    const rows = await db.select("users", { id: 1 });
    expect(rows[0]?.twilio_from_number).toBeNull();
  });

  it("clearing the default is idempotent — works on a row with no prior default", async () => {
    // User 1 was inserted with twilio_from_number = null. Calling
    // with senderId=null must still succeed without errors.
    expect(await readTwilioFromNumber(1)).toBeFalsy();
    const result = await __updateDefaultSenderIdInternal({
      userId: 1,
      senderId: null,
      db,
    });
    expect(result.twilioFromNumber).toBeNull();
    expect(await readTwilioFromNumber(1)).toBeFalsy();
  });

  it("rejects a sender id belonging to another user (no leak)", async () => {
    const bobsSid = await seedApprovedSenderId(db, 2, "BobsSender");

    await expect(
      __updateDefaultSenderIdInternal({
        userId: 1,
        senderId: bobsSid,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);

    // Alice's default is unchanged.
    expect(await readTwilioFromNumber(1)).toBeFalsy();
    // Bob's default is also untouched — Alice's failed call must
    // never have spilled into Bob's account.
    expect(await readTwilioFromNumber(2)).toBeFalsy();
  });

  it("rejects a non-existent sender id with the same error as wrong-user", async () => {
    await expect(
      __updateDefaultSenderIdInternal({
        userId: 1,
        senderId: 9999,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("rejects a sender id that isn't approved (status=pending)", async () => {
    const inserted = await db.insert("sender_ids", {
      user_id: 1,
      value: "PendingOne",
      status: "pending",
    });
    await expect(
      __updateDefaultSenderIdInternal({
        userId: 1,
        senderId: inserted.id as number,
        db,
      }),
    ).rejects.toThrow(/not approved/i);

    expect(await readTwilioFromNumber(1)).toBeFalsy();
  });

  it("rejects a sender id that isn't approved (status=rejected)", async () => {
    const inserted = await db.insert("sender_ids", {
      user_id: 1,
      value: "RejectedOne",
      status: "rejected",
    });
    await expect(
      __updateDefaultSenderIdInternal({
        userId: 1,
        senderId: inserted.id as number,
        db,
      }),
    ).rejects.toThrow(/not approved/i);
  });

  it("rejects non-positive inputs", async () => {
    await expect(
      __updateDefaultSenderIdInternal({ userId: 0, senderId: 1, db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __updateDefaultSenderIdInternal({ userId: 1, senderId: 0, db }),
    ).rejects.toThrow(/senderId must be a positive integer or null/i);
    await expect(
      __updateDefaultSenderIdInternal({ userId: 1, senderId: -5, db }),
    ).rejects.toThrow(/senderId must be a positive integer or null/i);
  });

  it("replaces a previous default when a new sender id is selected", async () => {
    const first = await seedApprovedSenderId(db, 1, "FirstSender");
    const second = await seedApprovedSenderId(db, 1, "SecondSender");

    await __updateDefaultSenderIdInternal({ userId: 1, senderId: first, db });
    expect(await readTwilioFromNumber(1)).toBe("FirstSender");

    await __updateDefaultSenderIdInternal({ userId: 1, senderId: second, db });
    expect(await readTwilioFromNumber(1)).toBe("SecondSender");
  });

  it("uses the same error shape for missing-row and wrong-user (no leak)", async () => {
    const bobsSid = await seedApprovedSenderId(db, 2, "BobsApproved");
    const missing = __updateDefaultSenderIdInternal({
      userId: 1,
      senderId: 9999,
      db,
    });
    const wrongUser = __updateDefaultSenderIdInternal({
      userId: 1,
      senderId: bobsSid,
      db,
    });
    await expect(missing).rejects.toThrow(/not found for user/i);
    await expect(wrongUser).rejects.toThrow(/not found for user/i);
  });
});

// ===========================================================================
// Public server actions — exercised through `requireUser()` + the singleton.
// ===========================================================================

describe("public settings server actions", () => {
  let db: TestDb;

  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await seedUser(db, { id: 1, name: "Alice" });
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  describe("updateProfileAction()", () => {
    it("rewrites users.name for the current override user", async () => {
      const result = await updateProfileAction({ name: "Renamed Alice" });
      expect(result.name).toBe("Renamed Alice");

      const rows = await db.select("users", { id: 1 });
      expect(rows[0]?.name).toBe("Renamed Alice");
    });

    it("rejects empty input without writing", async () => {
      await expect(updateProfileAction({ name: "" })).rejects.toThrow(
        /name is required/i,
      );
      const rows = await db.select("users", { id: 1 });
      expect(rows[0]?.name).toBe("Alice");
    });

    it("scopes to whichever user the override currently points at", async () => {
      await seedUser(db, { id: 2, name: "Bob" });
      __setCurrentUserIdForTests(2);

      await updateProfileAction({ name: "Renamed Bob" });

      const alice = await db.select("users", { id: 1 });
      const bob = await db.select("users", { id: 2 });
      expect(alice[0]?.name).toBe("Alice");
      expect(bob[0]?.name).toBe("Renamed Bob");
    });
  });

  describe("updateDefaultSenderIdAction()", () => {
    it("writes the default when the override user owns the sender id", async () => {
      const sid = await seedApprovedSenderId(db, 1, "+15551234567");
      const result = await updateDefaultSenderIdAction({ senderId: sid });
      expect(result.twilioFromNumber).toBe("+15551234567");

      const userRows = await db.select("users", { id: 1 });
      expect(userRows[0]?.twilio_from_number).toBe("+15551234567");
    });

    it("clears the default when senderId is null", async () => {
      const sid = await seedApprovedSenderId(db, 1, "+15551234567");
      await updateDefaultSenderIdAction({ senderId: sid });
      // Sanity check — it was set.
      let userRows = await db.select("users", { id: 1 });
      expect(userRows[0]?.twilio_from_number).toBe("+15551234567");

      await updateDefaultSenderIdAction({ senderId: null });
      userRows = await db.select("users", { id: 1 });
      expect(userRows[0]?.twilio_from_number).toBeNull();
    });

    it("rejects a sender id belonging to another user", async () => {
      await seedUser(db, { id: 2, name: "Bob" });
      const bobsSid = await seedApprovedSenderId(db, 2, "BobsSender");

      await expect(
        updateDefaultSenderIdAction({ senderId: bobsSid }),
      ).rejects.toThrow(/not found for user/i);

      // Alice's default is untouched.
      const alice = await db.select("users", { id: 1 });
      // seedUser for the public block explicitly wrote twilioFromNumber=null,
      // so the column reads back as `null` (not `undefined`). Either is a
      // "not set" state — both prove Alice's account wasn't touched.
      expect(alice[0]?.twilio_from_number ?? null).toBeNull();
      // Bob's default is untouched.
      const bob = await db.select("users", { id: 2 });
      expect(bob[0]?.twilio_from_number ?? null).toBeNull();
    });

    it("rejects a sender id that isn't approved", async () => {
      const inserted = await db.insert("sender_ids", {
        user_id: 1,
        value: "PendingOne",
        status: "pending",
      });
      await expect(
        updateDefaultSenderIdAction({ senderId: inserted.id as number }),
      ).rejects.toThrow(/not approved/i);
    });
  });
});