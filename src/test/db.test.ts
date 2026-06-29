import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";

/**
 * Smoke tests for the in-memory `TestDb` shim — particularly the
 * `delete()` method and the FK cascade for `contacts.group_id →
 * contact_groups.id ON DELETE SET NULL`.
 *
 * These tests are kept separate from `src/lib/**` tests because they
 * exercise the test infrastructure itself, not any production code.
 */

describe("TestDb.delete()", () => {
  it("removes matching rows from the target table", async () => {
    const db = createTestDb();
    await db.insert("contact_groups", { user_id: 1, name: "Group A" });
    await db.insert("contact_groups", { user_id: 1, name: "Group B" });

    const removed = await db.delete("contact_groups", { user_id: 1 });
    expect(removed).toBe(2);

    const remaining = await db.select("contact_groups");
    expect(remaining).toHaveLength(0);
  });

  it("only removes rows matching the `where` clause", async () => {
    const db = createTestDb();
    await db.insert("users", {
      id: 1,
      email: "a@x.com",
      password_hash: "x",
      name: "Alice",
    });
    await db.insert("users", {
      id: 2,
      email: "b@x.com",
      password_hash: "x",
      name: "Bob",
    });
    await db.insert("contact_groups", { user_id: 1, name: "AliceGroup" });
    await db.insert("contact_groups", { user_id: 2, name: "BobGroup" });

    const removed = await db.delete("contact_groups", { user_id: 1 });
    expect(removed).toBe(1);

    const remaining = await db.select("contact_groups");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ user_id: 2, name: "BobGroup" });
  });

  it("clears contacts.group_id when the parent group is deleted (ON DELETE SET NULL)", async () => {
    const db = createTestDb();
    await db.insert("users", {
      id: 1,
      email: "a@x.com",
      password_hash: "x",
      name: "Alice",
    });
    const group = await db.insert("contact_groups", {
      user_id: 1,
      name: "Customers",
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      group_id: group.id,
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15552222222",
      group_id: group.id,
    });
    // A contact that's NOT in the group — should be untouched.
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15553333333",
      group_id: null,
    });

    const removed = await db.delete("contact_groups", { id: group.id });
    expect(removed).toBe(1);

    // The group itself is gone.
    const groupsAfter = await db.select("contact_groups", { id: group.id });
    expect(groupsAfter).toHaveLength(0);

    // The contacts that were in the group now have group_id === null.
    const contactsAfter = await db.select("contacts", { user_id: 1 });
    expect(contactsAfter).toHaveLength(3);
    for (const c of contactsAfter) {
      expect(c.group_id).toBeNull();
    }
  });

  it("throws on an unknown table", async () => {
    const db = createTestDb();
    await expect(db.delete("not_a_table", {})).rejects.toThrow(
      /unknown table/i,
    );
  });
});