import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __addContactInternal,
  __deleteContactInternal,
  __editContactInternal,
  __exportContactsInternal,
  __importContactsInternal,
  addContactAction,
  deleteContactAction,
  editContactAction,
  exportContactsCsv,
  importContactsAction,
} from "@/lib/actions/contacts";
import { normalizePhone } from "@/lib/phone";
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

async function seedGroup(
  db: TestDb,
  userId: number,
  name: string,
): Promise<number> {
  const inserted = await db.insert("contact_groups", {
    user_id: userId,
    name,
  });
  return inserted.id as number;
}

// ===========================================================================
// normalizePhone — small enough that we cover it directly.
// ===========================================================================

describe("normalizePhone()", () => {
  it("returns null for null/undefined", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("returns null for empty / whitespace-only input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("strips cosmetic characters", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("555.123.4567")).toBe("+15551234567");
    expect(normalizePhone(" 555 123 4567 ")).toBe("+15551234567");
  });

  it("prepends +1 to 10-digit US numbers", () => {
    expect(normalizePhone("5551234567")).toBe("+15551234567");
  });

  it("prepends + to 11-digit US numbers starting with 1", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
  });

  it("prepends + to 11+ digit international numbers", () => {
    expect(normalizePhone("447911123456")).toBe("+447911123456");
  });

  it("preserves + prefix when supplied", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });

  it("throws on too-short numbers", () => {
    expect(() => normalizePhone("12345")).toThrow(/too short/i);
    expect(() => normalizePhone("+12345")).toThrow(/too short/i);
  });
});

// ===========================================================================
// Internal implementations — exercised directly with a fresh in-memory DB.
// ===========================================================================

describe("__addContactInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  it("inserts a contacts row scoped to the current user", async () => {
    const inserted = await __addContactInternal({
      userId: 1,
      phone: "5551234567",
      firstName: "Alice",
      lastName: "Wonder",
      db,
    });

    expect(inserted.id).toBeTypeOf("number");
    expect(inserted.id).toBeGreaterThan(0);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: inserted.id,
      user_id: 1,
      phone: "+15551234567",
      first_name: "Alice",
      last_name: "Wonder",
    });
  });

  it("normalizes the phone to E.164", async () => {
    const inserted = await __addContactInternal({
      userId: 1,
      phone: "(555) 123-4567",
      db,
    });
    const rows = await db.select("contacts", { id: inserted.id });
    expect(rows[0]?.phone).toBe("+15551234567");
  });

  it("stores null for missing firstName / lastName", async () => {
    const inserted = await __addContactInternal({
      userId: 1,
      phone: "5551234567",
      db,
    });
    const rows = await db.select("contacts", { id: inserted.id });
    expect(rows[0]?.first_name).toBeNull();
    expect(rows[0]?.last_name).toBeNull();
  });

  it("stores group_id when supplied", async () => {
    const group = await seedGroup(db, 1, "Customers");
    const inserted = await __addContactInternal({
      userId: 1,
      phone: "5551234567",
      groupId: group,
      db,
    });
    const rows = await db.select("contacts", { id: inserted.id });
    expect(rows[0]?.group_id).toBe(group);
  });

  it("stores group_id = null when omitted", async () => {
    const inserted = await __addContactInternal({
      userId: 1,
      phone: "5551234567",
      db,
    });
    const rows = await db.select("contacts", { id: inserted.id });
    expect(rows[0]?.group_id).toBeNull();
  });

  it("rejects a duplicate (userId, phone)", async () => {
    await __addContactInternal({ userId: 1, phone: "5551234567", db });
    await expect(
      __addContactInternal({ userId: 1, phone: "555-123-4567", db }),
    ).rejects.toThrow(/already exists/i);
  });

  it("rejects the same phone across different cosmetic formats", async () => {
    await __addContactInternal({ userId: 1, phone: "5551234567", db });
    await expect(
      __addContactInternal({ userId: 1, phone: "+1 (555) 123-4567", db }),
    ).rejects.toThrow(/already exists/i);
  });

  it("allows the same phone under different users", async () => {
    await __addContactInternal({ userId: 1, phone: "5551234567", db });
    await __addContactInternal({ userId: 2, phone: "5551234567", db });
    expect(await db.select("contacts")).toHaveLength(2);
  });

  it("rejects a missing phone", async () => {
    await expect(
      __addContactInternal({ userId: 1, phone: "", db }),
    ).rejects.toThrow(/phone is required/i);
    await expect(
      __addContactInternal({ userId: 1, phone: "   ", db }),
    ).rejects.toThrow(/phone is required/i);
  });

  it("rejects an unparseable phone", async () => {
    await expect(
      __addContactInternal({ userId: 1, phone: "12345", db }),
    ).rejects.toThrow(/too short/i);
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __addContactInternal({ userId: 0, phone: "5551234567", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });

  it("rejects a groupId that doesn't belong to the user", async () => {
    const bobsGroup = await seedGroup(db, 2, "BobsGroup");
    await expect(
      __addContactInternal({
        userId: 1,
        phone: "5551234567",
        groupId: bobsGroup,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("rejects a non-positive groupId", async () => {
    await expect(
      __addContactInternal({
        userId: 1,
        phone: "5551234567",
        groupId: 0,
        db,
      }),
    ).rejects.toThrow(/groupId must be a positive integer/i);
  });
});

describe("__editContactInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  async function seedContact(
    userId: number,
    phone: string,
    overrides: Partial<{
      first_name: string | null;
      last_name: string | null;
      group_id: number | null;
    }> = {},
  ): Promise<number> {
    const inserted = await db.insert("contacts", {
      user_id: userId,
      phone,
      first_name: overrides.first_name ?? null,
      last_name: overrides.last_name ?? null,
      group_id: overrides.group_id ?? null,
    });
    return inserted.id as number;
  }

  it("updates the firstName field", async () => {
    const id = await seedContact(1, "+15551234567", { first_name: "Old" });
    const result = await __editContactInternal({
      userId: 1,
      contactId: id,
      firstName: "New",
      db,
    });
    expect(result).toEqual({ id });

    const rows = await db.select("contacts", { id });
    expect(rows[0]?.first_name).toBe("New");
  });

  it("updates multiple fields at once", async () => {
    const group = await seedGroup(db, 1, "Customers");
    const id = await seedContact(1, "+15551234567", {
      first_name: "Old",
      last_name: "Name",
      group_id: null,
    });

    await __editContactInternal({
      userId: 1,
      contactId: id,
      firstName: "New",
      lastName: "Person",
      groupId: group,
      db,
    });

    const rows = await db.select("contacts", { id });
    expect(rows[0]).toMatchObject({
      first_name: "New",
      last_name: "Person",
      group_id: group,
    });
  });

  it("re-normalizes the phone and updates it", async () => {
    const id = await seedContact(1, "+15551234567");
    await __editContactInternal({
      userId: 1,
      contactId: id,
      phone: "(555) 999-0000",
      db,
    });
    const rows = await db.select("contacts", { id });
    expect(rows[0]?.phone).toBe("+15559990000");
  });

  it("clears group_id when groupId=null is supplied", async () => {
    const group = await seedGroup(db, 1, "Customers");
    const id = await seedContact(1, "+15551234567", { group_id: group });

    await __editContactInternal({
      userId: 1,
      contactId: id,
      groupId: null,
      db,
    });

    const rows = await db.select("contacts", { id });
    expect(rows[0]?.group_id).toBeNull();
  });

  it("clears firstName when null is supplied", async () => {
    const id = await seedContact(1, "+15551234567", { first_name: "Old" });
    await __editContactInternal({
      userId: 1,
      contactId: id,
      firstName: null,
      db,
    });
    const rows = await db.select("contacts", { id });
    expect(rows[0]?.first_name).toBeNull();
  });

  it("rejects when the contact belongs to another user", async () => {
    const bobsContact = await seedContact(2, "+15551234567", {
      first_name: "Bob",
    });
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: bobsContact,
        firstName: "Stolen",
        db,
      }),
    ).rejects.toThrow(/not found for user/i);

    // Bob's contact must NOT have been touched.
    const rows = await db.select("contacts", { id: bobsContact });
    expect(rows[0]?.first_name).toBe("Bob");
  });

  it("rejects when the contact does not exist", async () => {
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: 9999,
        firstName: "Anything",
        db,
      }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("rejects an empty phone when phone is supplied", async () => {
    const id = await seedContact(1, "+15551234567");
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: id,
        phone: "",
        db,
      }),
    ).rejects.toThrow(/phone cannot be empty/i);
  });

  it("rejects an unparseable phone when phone is supplied", async () => {
    const id = await seedContact(1, "+15551234567");
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: id,
        phone: "12345",
        db,
      }),
    ).rejects.toThrow(/too short/i);
  });

  it("rejects when the new phone duplicates another contact of the same user", async () => {
    await seedContact(1, "+15559990000");
    const id = await seedContact(1, "+15551111111");
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: id,
        phone: "5559990000",
        db,
      }),
    ).rejects.toThrow(/already exists/i);

    // Original contact untouched.
    const rows = await db.select("contacts", { id });
    expect(rows[0]?.phone).toBe("+15551111111");
  });

  it("allows a contact to keep its own phone (no false-positive dupe)", async () => {
    const id = await seedContact(1, "+15551234567");
    // Editing the same row with the SAME phone should NOT trip the
    // duplicate guard (we exclude the row under edit from the check).
    await __editContactInternal({
      userId: 1,
      contactId: id,
      phone: "5551234567",
      db,
    });
    const rows = await db.select("contacts", { id });
    expect(rows[0]?.phone).toBe("+15551234567");
  });

  it("rejects a non-positive contactId", async () => {
    await expect(
      __editContactInternal({
        userId: 1,
        contactId: 0,
        firstName: "x",
        db,
      }),
    ).rejects.toThrow(/contactId must be a positive integer/i);
  });

  it("is a no-op when no fields are supplied", async () => {
    const id = await seedContact(1, "+15551234567", { first_name: "Keep" });
    const result = await __editContactInternal({
      userId: 1,
      contactId: id,
      db,
    });
    expect(result).toEqual({ id });
    const rows = await db.select("contacts", { id });
    expect(rows[0]?.first_name).toBe("Keep");
  });
});

describe("__deleteContactInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  it("removes the contact", async () => {
    const inserted = await db.insert("contacts", {
      user_id: 1,
      phone: "+15551234567",
    });

    const result = await __deleteContactInternal({
      userId: 1,
      contactId: inserted.id as number,
      db,
    });
    expect(result).toEqual({ id: inserted.id });

    const rows = await db.select("contacts", { id: inserted.id });
    expect(rows).toHaveLength(0);
  });

  it("throws when the contact belongs to another user", async () => {
    const bobs = await db.insert("contacts", {
      user_id: 2,
      phone: "+15551234567",
    });

    await expect(
      __deleteContactInternal({
        userId: 1,
        contactId: bobs.id as number,
        db,
      }),
    ).rejects.toThrow(/not found for user/i);

    // Bob's contact must still exist.
    const rows = await db.select("contacts", { id: bobs.id });
    expect(rows).toHaveLength(1);
  });

  it("throws when the contact does not exist", async () => {
    await expect(
      __deleteContactInternal({ userId: 1, contactId: 9999, db }),
    ).rejects.toThrow(/not found for user/i);
  });

  it("uses the same error shape for missing-row and wrong-user", async () => {
    const bobs = await db.insert("contacts", {
      user_id: 2,
      phone: "+15551234567",
    });
    const missing = __deleteContactInternal({
      userId: 1,
      contactId: 9999,
      db,
    });
    const wrongUser = __deleteContactInternal({
      userId: 1,
      contactId: bobs.id as number,
      db,
    });
    await expect(missing).rejects.toThrow(/not found for user/i);
    await expect(wrongUser).rejects.toThrow(/not found for user/i);
  });

  it("rejects non-positive inputs", async () => {
    await expect(
      __deleteContactInternal({ userId: 0, contactId: 1, db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
    await expect(
      __deleteContactInternal({ userId: 1, contactId: 0, db }),
    ).rejects.toThrow(/contactId must be a positive integer/i);
  });
});

describe("__importContactsInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
  });

  it("parses a 3-row CSV into 3 contacts", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      "5551111111,Alice,Anderson,",
      "5552222222,Bob,Baker,",
      "5553333333,Carol,Carter,",
    ].join("\n");

    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });

    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.phone).sort()).toEqual([
      "+15551111111",
      "+15552222222",
      "+15553333333",
    ]);
    expect(rows.map((r) => r.first_name).sort()).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("normalizes each phone to E.164", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      "(555) 111-1111,Alice,",
      "+15552222222,Bob,",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(2);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows.map((r) => r.phone).sort()).toEqual([
      "+15551111111",
      "+15552222222",
    ]);
  });

  it("assigns groupId when the column is populated and refers to a valid group", async () => {
    const group = await seedGroup(db, 1, "VIP");
    const csv = [
      "phone,firstName,lastName,groupId",
      `5551111111,Alice,,${group}`,
    ].join("\n");

    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(1);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows[0]?.group_id).toBe(group);
  });

  it("reports an error when groupId refers to a group the user doesn't own", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      "5551111111,Alice,,9999",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 1 });
    expect(result.errors[0]?.message).toMatch(/groupId 9999/i);
  });

  it("skips rows with empty phones and counts them as skipped", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      ",Alice,",
      "5551111111,Bob,",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phone).toBe("+15551111111");
  });

  it("skips duplicates within the same CSV (second occurrence is skipped)", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      "5551111111,Alice,",
      "5551111111,AliceAgain,",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(1);
    expect(result.skipped).toBe(1);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.first_name).toBe("Alice");
  });

  it("skips duplicates against pre-existing contacts", async () => {
    await __addContactInternal({
      userId: 1,
      phone: "5551111111",
      firstName: "AlreadyThere",
      db,
    });
    const csv = [
      "phone,firstName,lastName,groupId",
      "5551111111,ShouldNotImport,",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(1);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.first_name).toBe("AlreadyThere");
  });

  it("reports an error when the phone is too short", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      "12345,Bad,",
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 1 });
    expect(result.errors[0]?.message).toMatch(/too short/i);
  });

  it("returns an empty summary for an empty CSV (just a header)", async () => {
    const csv = "phone,firstName,lastName,groupId\n";
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result).toEqual({ inserted: 0, skipped: 0, errors: [] });
  });

  it("throws when the header is missing the phone column", async () => {
    const csv = ["firstName,lastName", "Alice,Anderson"].join("\n");
    await expect(
      __importContactsInternal({ userId: 1, csv, db }),
    ).rejects.toThrow(/missing required "phone" column/i);
  });

  it("tolerates quoted fields with commas", async () => {
    const csv = [
      "phone,firstName,lastName,groupId",
      '"5551111111","Smith, John",Doe,',
    ].join("\n");
    const result = await __importContactsInternal({
      userId: 1,
      csv,
      db,
    });
    expect(result.inserted).toBe(1);
    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows[0]?.first_name).toBe("Smith, John");
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __importContactsInternal({ userId: 0, csv: "", db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });

  it("rejects a non-string csv", async () => {
    await expect(
      // @ts-expect-error -- intentional bad input
      __importContactsInternal({ userId: 1, csv: 42, db }),
    ).rejects.toThrow(/csv must be a string/i);
  });
});

describe("__exportContactsInternal()", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedUser(db, 2, "bob@example.com");
  });

  it("returns a CSV containing every contact for the current user", async () => {
    await __addContactInternal({
      userId: 1,
      phone: "5551111111",
      firstName: "Alice",
      lastName: "Anderson",
      db,
    });
    await __addContactInternal({
      userId: 1,
      phone: "5552222222",
      firstName: "Bob",
      lastName: "Baker",
      db,
    });
    // Bob-the-other-user's contact should NOT appear in Alice's export.
    await __addContactInternal({
      userId: 2,
      phone: "5559999999",
      firstName: "Other",
      db,
    });

    const result = await __exportContactsInternal({ userId: 1, db });
    expect(result.filename).toMatch(/^contacts-\d{8}-\d{4}\.csv$/);
    expect(result.csv).toContain("phone,firstName,lastName,groupId");
    expect(result.csv).toContain("+15551111111");
    expect(result.csv).toContain("Alice");
    expect(result.csv).toContain("+15552222222");
    expect(result.csv).toContain("Bob");
    // Other user's contact must not leak.
    expect(result.csv).not.toContain("+15559999999");
    expect(result.csv).not.toContain("Other");
  });

  it("returns just the header for a user with no contacts", async () => {
    const result = await __exportContactsInternal({ userId: 1, db });
    expect(result.csv).toBe("phone,firstName,lastName,groupId\n");
  });

  it("escapes commas in fields", async () => {
    await __addContactInternal({
      userId: 1,
      phone: "5551111111",
      firstName: "Smith, John",
      db,
    });
    const result = await __exportContactsInternal({ userId: 1, db });
    expect(result.csv).toContain('"Smith, John"');
  });

  it("round-trips: export then import yields the same contacts", async () => {
    await __addContactInternal({
      userId: 1,
      phone: "5551111111",
      firstName: "Alice",
      lastName: "Anderson",
      db,
    });
    await __addContactInternal({
      userId: 1,
      phone: "(555) 222-2222",
      firstName: "Bob",
      db,
    });

    const exported = await __exportContactsInternal({ userId: 1, db });
    // Wipe and re-import.
    await db.delete("contacts", { user_id: 1 });
    expect(await db.select("contacts", { user_id: 1 })).toHaveLength(0);

    const imported = await __importContactsInternal({
      userId: 1,
      csv: exported.csv,
      db,
    });
    expect(imported.inserted).toBe(2);

    const rows = await db.select("contacts", { user_id: 1 });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.phone).sort()).toEqual([
      "+15551111111",
      "+15552222222",
    ]);
  });

  it("rejects a non-positive userId", async () => {
    await expect(
      __exportContactsInternal({ userId: 0, db }),
    ).rejects.toThrow(/userId must be a positive integer/i);
  });
});

// ===========================================================================
// Public server actions — exercised through `requireUser()` + the singleton.
// ===========================================================================

describe("public contacts server actions", () => {
  let db: TestDb;

  beforeEach(async () => {
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

  describe("addContactAction()", () => {
    it("inserts a contact scoped to the current user", async () => {
      const result = await addContactAction({
        phone: "5551234567",
        firstName: "Alice",
        lastName: "Wonder",
      });
      expect(result.id).toBeTypeOf("number");

      const rows = await db.select("contacts", { user_id: 1 });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: result.id,
        phone: "+15551234567",
        first_name: "Alice",
        last_name: "Wonder",
      });
    });

    it("rejects a duplicate for the same user", async () => {
      await addContactAction({ phone: "5551234567" });
      await expect(
        addContactAction({ phone: "(555) 123-4567" }),
      ).rejects.toThrow(/already exists/i);
    });
  });

  describe("editContactAction()", () => {
    it("edits the user's own contact", async () => {
      const inserted = await db.insert("contacts", {
        user_id: 1,
        phone: "+15551234567",
        first_name: "Old",
      });

      const result = await editContactAction({
        id: inserted.id as number,
        firstName: "New",
      });
      expect(result).toEqual({ id: inserted.id });

      const rows = await db.select("contacts", { id: inserted.id });
      expect(rows[0]?.first_name).toBe("New");
    });

    it("throws when the contact belongs to another user", async () => {
      await seedUser(db, 2, "bob@example.com");
      const bobs = await db.insert("contacts", {
        user_id: 2,
        phone: "+15551234567",
        first_name: "Bob",
      });

      await expect(
        editContactAction({
          id: bobs.id as number,
          firstName: "Stolen",
        }),
      ).rejects.toThrow(/not found for user/i);

      const rows = await db.select("contacts", { id: bobs.id });
      expect(rows[0]?.first_name).toBe("Bob");
    });
  });

  describe("deleteContactAction()", () => {
    it("deletes the user's own contact", async () => {
      const inserted = await db.insert("contacts", {
        user_id: 1,
        phone: "+15551234567",
      });

      const result = await deleteContactAction({
        id: inserted.id as number,
      });
      expect(result).toEqual({ id: inserted.id });

      const rows = await db.select("contacts", { id: inserted.id });
      expect(rows).toHaveLength(0);
    });

    it("throws when the contact belongs to another user", async () => {
      await seedUser(db, 2, "bob@example.com");
      const bobs = await db.insert("contacts", {
        user_id: 2,
        phone: "+15551234567",
      });

      await expect(
        deleteContactAction({ id: bobs.id as number }),
      ).rejects.toThrow(/not found for user/i);

      const rows = await db.select("contacts", { id: bobs.id });
      expect(rows).toHaveLength(1);
    });
  });

  describe("importContactsAction()", () => {
    it("imports a 3-row CSV", async () => {
      const csv = [
        "phone,firstName,lastName,groupId",
        "5551111111,Alice,Anderson,",
        "5552222222,Bob,Baker,",
        "5553333333,Carol,Carter,",
      ].join("\n");
      const result = await importContactsAction({ csv });
      expect(result.inserted).toBe(3);

      const rows = await db.select("contacts", { user_id: 1 });
      expect(rows).toHaveLength(3);
    });
  });

  describe("exportContactsCsv()", () => {
    it("returns a CSV containing the user's contacts", async () => {
      await db.insert("contacts", {
        user_id: 1,
        phone: "+15551111111",
        first_name: "Alice",
      });
      await db.insert("contacts", {
        user_id: 1,
        phone: "+15552222222",
        first_name: "Bob",
      });

      const result = await exportContactsCsv();
      expect(result.csv).toContain("+15551111111");
      expect(result.csv).toContain("Alice");
      expect(result.csv).toContain("+15552222222");
      expect(result.csv).toContain("Bob");
    });

    it("scopes the export to the current user", async () => {
      await seedUser(db, 2, "bob@example.com");
      await db.insert("contacts", {
        user_id: 1,
        phone: "+15551111111",
        first_name: "Alice",
      });
      await db.insert("contacts", {
        user_id: 2,
        phone: "+15559999999",
        first_name: "Other",
      });

      const result = await exportContactsCsv();
      expect(result.csv).toContain("+15551111111");
      expect(result.csv).not.toContain("+15559999999");
      expect(result.csv).not.toContain("Other");
    });
  });
});