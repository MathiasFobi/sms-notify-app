import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __requestSenderIdInternal,
  __setDefaultSenderIdInternal,
  requestSenderIdAction,
  setDefaultSenderIdAction,
} from "@/lib/actions/sender-ids";
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
 * Test seeding helpers — keep tests focused on the action behavior.
 */
async function seedUser(db: TestDb, id: number, email: string): Promise<void> {
  await db.insert("users", { id, email, password_hash: "x", name: email });
}

// ===========================================================================
// Internal implementations — exercised directly with a fresh in-memory DB.
// The public actions wrap these and add `requireUser()` + cookie handling;
// those are tested in the next `describe` block using the singleton.
// ===========================================================================

describe("__requestSenderIdInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  it("inserts a sender_ids row with status='approved' (mock auto-approve) for the current user", async () => {
    const inserted = await __requestSenderIdInternal({
      userId: 1,
      value: "MyBrand",
      db,
    });

    expect(inserted.id).toBeTypeOf("number");
    expect(inserted.id).toBeGreaterThan(0);

    const rows = await db.select("sender_ids", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: inserted.id,
      user_id: 1,
      value: "MyBrand",
      // MOCK-DATA BUILD: auto-approves on request so the flow
      // works without an admin UI. When the real DB lands this
      // will flip back to 'pending'.
      status: "approved",
    });

    // The mock-build also sets this value as the user's default
    // `twilio_from_number` on the same call.
    const users = await db.select("users", { id: 1 });
    expect(users[0]?.twilio_from_number).toBe("MyBrand");
  });

  it("scopes the insert to the user — other users do not see the row", async () => {
    await __requestSenderIdInternal({ userId: 1, value: "AliceCo", db });
    await __requestSenderIdInternal({ userId: 2, value: "BobCo", db });

    const aliceRows = await db.select("sender_ids", { user_id: 1 });
    const bobRows = await db.select("sender_ids", { user_id: 2 });

    expect(aliceRows.map((r) => r.value)).toEqual(["AliceCo"]);
    expect(bobRows.map((r) => r.value)).toEqual(["BobCo"]);
  });

  it("trims surrounding whitespace from the value", async () => {
    const inserted = await __requestSenderIdInternal({
      userId: 1,
      value: "  TrimMe  ",
      db,
    });
    const rows = await db.select("sender_ids", { id: inserted.id });
    expect(rows[0]?.value).toBe("TrimMe");
  });

  it("rejects an empty value", async () => {
    await expect(
      __requestSenderIdInternal({ userId: 1, value: "", db }),
    ).rejects.toThrow(/value is required/i);
    await expect(
      __requestSenderIdInternal({ userId: 1, value: "   ", db }),
    ).rejects.toThrow(/value is required/i);
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __requestSenderIdInternal({ userId: 0, value: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __requestSenderIdInternal({ userId: -1, value: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });

  it("rejects a duplicate (userId, value) — same user, same value", async () => {
    await __requestSenderIdInternal({ userId: 1, value: "Dup", db });
    await expect(
      __requestSenderIdInternal({ userId: 1, value: "Dup", db }),
    ).rejects.toThrow(/already exists/i);
  });

  it("allows the same value across different users", async () => {
    await __requestSenderIdInternal({ userId: 1, value: "Shared", db });
    await __requestSenderIdInternal({ userId: 2, value: "Shared", db });
    const rows = await db.select("sender_ids");
    expect(rows).toHaveLength(2);
  });
});

describe("__setDefaultSenderIdInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  async function seedApprovedSenderId(
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

  async function readTwilioFromNumber(userId: number): Promise<string | null> {
    const rows = await db.select("users", { id: userId });
    const v = rows[0]?.twilio_from_number;
    return typeof v === "string" ? v : null;
  }

  it("writes users.twilioFromNumber for the current user on success", async () => {
    const id = await seedApprovedSenderId(1, "+15551234567");
    expect(await readTwilioFromNumber(1)).toBeNull();

    const result = await __setDefaultSenderIdInternal({
      userId: 1,
      senderIdRowId: id,
      db,
    });
    expect(result.twilioFromNumber).toBe("+15551234567");
    expect(await readTwilioFromNumber(1)).toBe("+15551234567");
  });

  it("throws when the sender id status is 'pending'", async () => {
    const id = await db
      .insert("sender_ids", {
        user_id: 1,
        value: "PendingCo",
        status: "pending",
      })
      .then((r) => r.id as number);

    await expect(
      __setDefaultSenderIdInternal({ userId: 1, senderIdRowId: id, db }),
    ).rejects.toThrow(/not approved/i);

    // And nothing was written.
    expect(await readTwilioFromNumber(1)).toBeNull();
  });

  it("throws when the sender id status is 'rejected'", async () => {
    const id = await db
      .insert("sender_ids", {
        user_id: 1,
        value: "RejectedCo",
        status: "rejected",
      })
      .then((r) => r.id as number);

    await expect(
      __setDefaultSenderIdInternal({ userId: 1, senderIdRowId: id, db }),
    ).rejects.toThrow(/not approved/i);
  });

  it("throws when the sender id belongs to another user", async () => {
    const id = await seedApprovedSenderId(2, "BobsSender");

    await expect(
      __setDefaultSenderIdInternal({ userId: 1, senderIdRowId: id, db }),
    ).rejects.toThrow(/not found for user/i);

    // User 1's twilioFromNumber must not be touched.
    expect(await readTwilioFromNumber(1)).toBeNull();
    // And Bob's sender id value must not leak into Alice's account
    // just because she tried to adopt it.
    expect(await readTwilioFromNumber(2)).toBeNull();
  });

  it("throws when the sender id does not exist at all", async () => {
    await expect(
      __setDefaultSenderIdInternal({ userId: 1, senderIdRowId: 9999, db }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("throws on non-positive inputs", async () => {
    await expect(
      __setDefaultSenderIdInternal({ userId: 0, senderIdRowId: 1, db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __setDefaultSenderIdInternal({ userId: 1, senderIdRowId: 0, db }),
    ).rejects.toThrow(/senderIdRowId must be a positive integer/i);
  });

  it("uses the same error shape for missing-row and wrong-user", async () => {
    // Sanity: both paths must throw the same generic message so the
    // server doesn't leak whether a given id belongs to someone else.
    const otherUserId = await seedApprovedSenderId(2, "OtherUser");
    const missing = __setDefaultSenderIdInternal({
      userId: 1,
      senderIdRowId: 9999,
      db,
    });
    const wrongUser = __setDefaultSenderIdInternal({
      userId: 1,
      senderIdRowId: otherUserId,
      db,
    });
    await expect(missing).rejects.toThrow(/not found for user/i);
    await expect(wrongUser).rejects.toThrow(/not found for user/i);
  });
});

// ===========================================================================
// Public server actions — exercised through `requireUser()` + the singleton.
// These tests verify the auth-gating layer on top of the internal logic.
// ===========================================================================

describe("public sender-ids server actions", () => {
  let db: TestDb;

  beforeEach(async () => {
    // Reset the singleton DB and the requireUser override so every
    // test starts from a clean slate. The actions and requireUser both
    // read from the same singleton, so we MUST seed via it.
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await seedUser(db, 1, "alice@example.com");
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  describe("requestSenderIdAction()", () => {
    it("inserts an approved row scoped to the current user (mock auto-approve)", async () => {
      expect(await db.select("sender_ids", { user_id: 1 })).toHaveLength(0);

      await requestSenderIdAction({ value: "ViaAuth" });

      const after = await db.select("sender_ids", { user_id: 1 });
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ value: "ViaAuth", status: "approved" });
    });

    it("scopes to whichever user the override currently points at", async () => {
      // Flip the override to a different (existing) user — wait, we
      // only seeded user 1 here. Seed user 2 and switch.
      await seedUser(db, 2, "bob@example.com");
      __setCurrentUserIdForTests(2);

      await requestSenderIdAction({ value: "BobsViaAuth" });

      const bob = await db.select("sender_ids", { user_id: 2 });
      const alice = await db.select("sender_ids", { user_id: 1 });
      expect(bob).toHaveLength(1);
      expect(bob[0]?.value).toBe("BobsViaAuth");
      expect(alice).toHaveLength(0);
    });
  });

  describe("setDefaultSenderIdAction()", () => {
    it("writes users.twilioFromNumber when the override user owns an approved sender id", async () => {
      const inserted = await db.insert("sender_ids", {
        user_id: 1,
        value: "ViaAuthDefault",
        status: "approved",
      });

      await setDefaultSenderIdAction({ id: inserted.id as number });

      const userRows = await db.select("users", { id: 1 });
      expect(userRows[0]?.twilio_from_number).toBe("ViaAuthDefault");
    });

    it("throws when the sender id is not approved", async () => {
      const inserted = await db.insert("sender_ids", {
        user_id: 1,
        value: "PendingOne",
        status: "pending",
      });

      await expect(
        setDefaultSenderIdAction({ id: inserted.id as number }),
      ).rejects.toThrow(/not approved/i);
    });

    it("throws when the sender id belongs to another user", async () => {
      await seedUser(db, 2, "bob@example.com");
      const inserted = await db.insert("sender_ids", {
        user_id: 2,
        value: "BobsApproved",
        status: "approved",
      });

      // Alice (current override) tries to claim Bob's approved sender id.
      await expect(
        setDefaultSenderIdAction({ id: inserted.id as number }),
      ).rejects.toThrow(/not found for user/i);

      // Alice's account must NOT have been modified. The field was
      // never set on insert so it's `undefined` in the row.
      const alice = await db.select("users", { id: 1 });
      expect(alice[0]?.twilio_from_number).toBeUndefined();
    });
  });
});