import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
  requireAdmin,
} from "@/lib/auth";
import { __resetTestDbForTests, getTestDb, type TestDb } from "@/test/db";

/**
 * Tests for `requireAdmin()` (US-019).
 *
 * Mirrors the existing `requireUser()` test seam: the singleton DB
 * is seeded with a user row (with the `role` column set to the value
 * under test), the auth override is set to that user, and
 * `requireAdmin()` is called.
 *
 * Coverage:
 *   - admin caller → returns `{ id, row }` with the seeded row.
 *   - non-admin caller (`role='user'`) → throws `notFound()` (a
 *     Next.js sentinel — we assert on `rejects.toThrow()`).
 *   - unauthenticated caller → throws (no override, no cookie).
 *   - user row with `role` set to garbage → throws `notFound()`.
 */

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(
  db: TestDb,
  args: { id: number; role?: "user" | "admin"; email?: string; name?: string },
): Promise<void> {
  await db.insert("users", {
    id: args.id,
    email: args.email ?? `u${args.id}@example.com`,
    password_hash: "x",
    name: args.name ?? `User ${args.id}`,
    role: args.role ?? "user",
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("requireAdmin() (US-019)", () => {
  let db: TestDb;

  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
  });

  it("returns { id, row } when the current user has role='admin'", async () => {
    await seedUser(db, { id: 1, role: "admin", name: "Root" });
    __setCurrentUserIdForTests(1);

    const result = await requireAdmin();
    expect(result.id).toBe(1);
    expect(result.row.email).toBe("u1@example.com");
    expect(result.row.role).toBe("admin");
  });

  it("throws notFound() when the current user has role='user'", async () => {
    await seedUser(db, { id: 1, role: "user", name: "Alice" });
    __setCurrentUserIdForTests(1);

    // `notFound()` throws a special error that Next.js catches
    // and converts to a 404 response — we assert on the throw.
    await expect(requireAdmin()).rejects.toThrow();
  });

  it("throws notFound() when the override points at a non-existent user", async () => {
    // No seed — the DB is empty.
    __setCurrentUserIdForTests(999);
    await expect(requireAdmin()).rejects.toThrow();
  });

  it("throws when no override is set (no cookie + no override)", async () => {
    // The require-user seam throws on missing cookie / override;
    // verify the chain bubbles that to requireAdmin too.
    __resetCurrentUserForTests();
    await expect(requireAdmin()).rejects.toThrow();
  });

  it("throws notFound() when role is an unexpected string", async () => {
    await db.insert("users", {
      id: 1,
      email: "u1@example.com",
      password_hash: "x",
      name: "Alice",
      // Force an unexpected value past the schema default to
      // verify the strict equality check rejects it.
      role: "owner",
    });
    __setCurrentUserIdForTests(1);

    await expect(requireAdmin()).rejects.toThrow();
  });

  it("throws notFound() when role is missing entirely", async () => {
    // Insert without a role to model a corrupted / pre-migration
    // row. The shim returns `undefined` for the missing key.
    await db.insert("users", {
      id: 1,
      email: "u1@example.com",
      password_hash: "x",
      name: "Alice",
    });
    __setCurrentUserIdForTests(1);

    await expect(requireAdmin()).rejects.toThrow();
  });
});