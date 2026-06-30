import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __createContactGroupInternal,
  __deleteContactGroupInternal,
  __renameContactGroupInternal,
  createContactGroupAction,
  deleteContactGroupAction,
  renameContactGroupAction,
} from "@/lib/actions/contact-groups";
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
// The public actions wrap these and add `requireUser()` + the singleton DB;
// those are tested in the next `describe` block.
// ===========================================================================

describe("__createContactGroupInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  it("inserts a contact_groups row scoped to the current user", async () => {
    const inserted = await __createContactGroupInternal({
      userId: 1,
      name: "Customers",
      db,
    });

    expect(inserted.id).toBeTypeOf("number");
    expect(inserted.id).toBeGreaterThan(0);

    const rows = await db.select("contact_groups", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: inserted.id,
      user_id: 1,
      name: "Customers",
    });
  });

  it("scopes the insert to the user — other users do not see the row", async () => {
    await __createContactGroupInternal({ userId: 1, name: "AliceGroup", db });
    await __createContactGroupInternal({ userId: 2, name: "BobGroup", db });

    const aliceRows = await db.select("contact_groups", { user_id: 1 });
    const bobRows = await db.select("contact_groups", { user_id: 2 });

    expect(aliceRows.map((r) => r.name)).toEqual(["AliceGroup"]);
    expect(bobRows.map((r) => r.name)).toEqual(["BobGroup"]);
  });

  it("trims surrounding whitespace from the name", async () => {
    const inserted = await __createContactGroupInternal({
      userId: 1,
      name: "  TrimMe  ",
      db,
    });
    const rows = await db.select("contact_groups", { id: inserted.id });
    expect(rows[0]?.name).toBe("TrimMe");
  });

  it("rejects an empty name", async () => {
    await expect(
      __createContactGroupInternal({ userId: 1, name: "", db }),
    ).rejects.toThrow(/name is required/i);
    await expect(
      __createContactGroupInternal({ userId: 1, name: "   ", db }),
    ).rejects.toThrow(/name is required/i);
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __createContactGroupInternal({ userId: 0, name: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __createContactGroupInternal({ userId: -1, name: "x", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });

  it("allows two groups with the same name under different users", async () => {
    // Per-user scoping means name uniqueness is NOT enforced globally.
    // Real Postgres has no unique index on (userId, name) so this is the
    // documented behavior — duplicate names within the same user's
    // list ARE allowed (the user can rename to disambiguate).
    await __createContactGroupInternal({ userId: 1, name: "Shared", db });
    await __createContactGroupInternal({ userId: 2, name: "Shared", db });
    const rows = await db.select("contact_groups");
    expect(rows).toHaveLength(2);
  });
});

describe("__renameContactGroupInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  async function seedGroup(userId: number, name: string): Promise<number> {
    const inserted = await db.insert("contact_groups", {
      user_id: userId,
      name,
    });
    return inserted.id as number;
  }

  it("renames the row and returns the new name", async () => {
    const id = await seedGroup(1, "OldName");

    const result = await __renameContactGroupInternal({
      userId: 1,
      groupId: id,
      name: "NewName",
      db,
    });
    expect(result).toEqual({ id, name: "NewName" });

    const rows = await db.select("contact_groups", { id });
    expect(rows[0]?.name).toBe("NewName");
  });

  it("trims surrounding whitespace from the new name", async () => {
    const id = await seedGroup(1, "OldName");
    await __renameContactGroupInternal({
      userId: 1,
      groupId: id,
      name: "  Padded  ",
      db,
    });
    const rows = await db.select("contact_groups", { id });
    expect(rows[0]?.name).toBe("Padded");
  });

  it("rejects an empty name", async () => {
    const id = await seedGroup(1, "KeepMe");
    await expect(
      __renameContactGroupInternal({ userId: 1, groupId: id, name: "", db }),
    ).rejects.toThrow(/name is required/i);
    // Row unchanged.
    const rows = await db.select("contact_groups", { id });
    expect(rows[0]?.name).toBe("KeepMe");
  });

  it("throws when the group belongs to another user", async () => {
    const id = await seedGroup(2, "BobsGroup");

    await expect(
      __renameContactGroupInternal({
        userId: 1,
        groupId: id,
        name: "StolenName",
        db,
      }),
    ).rejects.toThrow(/not found for user/i);

    // And Bob's group must NOT have been touched.
    const rows = await db.select("contact_groups", { id });
    expect(rows[0]?.name).toBe("BobsGroup");
  });

  it("throws when the group does not exist", async () => {
    await expect(
      __renameContactGroupInternal({
        userId: 1,
        groupId: 9999,
        name: "Anything",
        db,
      }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("uses the same error shape for missing-row and wrong-user", async () => {
    // Existence-leak guard: both paths must throw the same generic
    // message so the server doesn't leak whether a given id belongs
    // to someone else.
    const bobsId = await seedGroup(2, "Bob");
    const missing = __renameContactGroupInternal({
      userId: 1,
      groupId: 9999,
      name: "x",
      db,
    });
    const wrongUser = __renameContactGroupInternal({
      userId: 1,
      groupId: bobsId,
      name: "x",
      db,
    });
    await expect(missing).rejects.toThrow(/not found for user/i);
    await expect(wrongUser).rejects.toThrow(/not found for user/i);
  });

  it("rejects non-positive inputs", async () => {
    await expect(
      __renameContactGroupInternal({
        userId: 0,
        groupId: 1,
        name: "x",
        db,
      }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __renameContactGroupInternal({
        userId: 1,
        groupId: 0,
        name: "x",
        db,
      }),
    ).rejects.toThrow(/groupId must be a positive integer/i);
  });
});

describe("__deleteContactGroupInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  async function seedGroup(userId: number, name: string): Promise<number> {
    const inserted = await db.insert("contact_groups", {
      user_id: userId,
      name,
    });
    return inserted.id as number;
  }

  it("removes the row and returns its id", async () => {
    const id = await seedGroup(1, "Doomed");

    const result = await __deleteContactGroupInternal({
      userId: 1,
      groupId: id,
      db,
    });
    expect(result).toEqual({ id });

    const rows = await db.select("contact_groups", { id });
    expect(rows).toHaveLength(0);
  });

  it("clears contacts.group_id via the ON DELETE SET NULL cascade", async () => {
    const group = await seedGroup(1, "Customers");
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      group_id: group,
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15552222222",
      group_id: group,
    });
    // A contact NOT in this group — must remain untouched.
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15553333333",
      group_id: null,
    });

    await __deleteContactGroupInternal({
      userId: 1,
      groupId: group,
      db,
    });

    const contacts = await db.select("contacts", { user_id: 1 });
    expect(contacts).toHaveLength(3);
    for (const c of contacts) {
      expect(c.group_id).toBeNull();
    }
  });

  it("does not touch contacts belonging to other groups", async () => {
    const keep = await seedGroup(1, "Keep");
    const drop = await seedGroup(1, "Drop");
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      group_id: keep,
    });

    await __deleteContactGroupInternal({
      userId: 1,
      groupId: drop,
      db,
    });

    const keepContacts = await db.select("contacts", { user_id: 1 });
    expect(keepContacts).toHaveLength(1);
    expect(keepContacts[0]?.group_id).toBe(keep);
  });

  it("throws when the group belongs to another user", async () => {
    const bobsGroup = await seedGroup(2, "BobsGroup");
    await expect(
      __deleteContactGroupInternal({
        userId: 1,
        groupId: bobsGroup,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);

    // Bob's group must still exist.
    const rows = await db.select("contact_groups", { id: bobsGroup });
    expect(rows).toHaveLength(1);
  });

  it("throws when the group does not exist", async () => {
    await expect(
      __deleteContactGroupInternal({
        userId: 1,
        groupId: 9999,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("rejects non-positive inputs", async () => {
    await expect(
      __deleteContactGroupInternal({
        userId: 0,
        groupId: 1,
        db,
      }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __deleteContactGroupInternal({
        userId: 1,
        groupId: 0,
        db,
      }),
    ).rejects.toThrow(/groupId must be a positive integer/i);
  });
});

// ===========================================================================
// Public server actions — exercised through `requireUser()` + the singleton.
// These tests verify the auth-gating layer on top of the internal logic.
// ===========================================================================

describe("public contact-groups server actions", () => {
  let db: TestDb;

  beforeEach(async () => {
    // Reset the singleton DB and the requireUser override so every
    // test starts from a clean slate. The actions and requireUser
    // both read from the same singleton, so we MUST seed via it.
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

  describe("createContactGroupAction()", () => {
    it("inserts a group scoped to the current user", async () => {
      expect(await db.select("contact_groups", { user_id: 1 })).toHaveLength(0);

      const result = await createContactGroupAction({ name: "ViaAuth" });
      expect(result.id).toBeTypeOf("number");

      const after = await db.select("contact_groups", { user_id: 1 });
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: result.id, name: "ViaAuth" });
    });

    it("scopes to whichever user the override currently points at", async () => {
      await seedUser(db, 2, "bob@example.com");
      __setCurrentUserIdForTests(2);

      await createContactGroupAction({ name: "BobsGroupViaAuth" });

      const bob = await db.select("contact_groups", { user_id: 2 });
      const alice = await db.select("contact_groups", { user_id: 1 });
      expect(bob).toHaveLength(1);
      expect(bob[0]?.name).toBe("BobsGroupViaAuth");
      expect(alice).toHaveLength(0);
    });
  });

  describe("renameContactGroupAction()", () => {
    it("renames the user's own group", async () => {
      const inserted = await db.insert("contact_groups", {
        user_id: 1,
        name: "Old",
      });

      const result = await renameContactGroupAction({
        id: inserted.id as number,
        name: "New",
      });
      expect(result).toEqual({ id: inserted.id, name: "New" });

      const rows = await db.select("contact_groups", { id: inserted.id });
      expect(rows[0]?.name).toBe("New");
    });

    it("throws when the group belongs to another user", async () => {
      await seedUser(db, 2, "bob@example.com");
      const bobs = await db.insert("contact_groups", {
        user_id: 2,
        name: "BobsGroup",
      });

      await expect(
        renameContactGroupAction({
          id: bobs.id as number,
          name: "StolenName",
        }),
      ).rejects.toThrow(/not found for user/i);

      // Bob's group untouched.
      const rows = await db.select("contact_groups", { id: bobs.id });
      expect(rows[0]?.name).toBe("BobsGroup");
    });
  });

  describe("deleteContactGroupAction()", () => {
    it("removes the user's own group", async () => {
      const inserted = await db.insert("contact_groups", {
        user_id: 1,
        name: "Doomed",
      });

      const result = await deleteContactGroupAction({
        id: inserted.id as number,
      });
      expect(result).toEqual({ id: inserted.id });

      const rows = await db.select("contact_groups", { id: inserted.id });
      expect(rows).toHaveLength(0);
    });

    it("clears contacts.group_id on cascade", async () => {
      const group = await db.insert("contact_groups", {
        user_id: 1,
        name: "Customers",
      });
      await db.insert("contacts", {
        user_id: 1,
        phone: "+15551111111",
        group_id: group.id,
      });

      await deleteContactGroupAction({ id: group.id as number });

      const contacts = await db.select("contacts", { user_id: 1 });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]?.group_id).toBeNull();
    });

    it("throws when the group belongs to another user", async () => {
      await seedUser(db, 2, "bob@example.com");
      const bobs = await db.insert("contact_groups", {
        user_id: 2,
        name: "BobsGroup",
      });

      await expect(
        deleteContactGroupAction({ id: bobs.id as number }),
      ).rejects.toThrow(/not found for user/i);

      // Bob's group untouched.
      const rows = await db.select("contact_groups", { id: bobs.id });
      expect(rows).toHaveLength(1);
    });
  });
});