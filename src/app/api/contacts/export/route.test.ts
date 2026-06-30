import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import {
  __resetTestDbForTests,
  getTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Tests for `GET /api/contacts/export`.
 *
 * The route handler is a thin shell over `exportContactsCsv()` plus
 * an auth gate (`requireUser()`). We seed the singleton DB (the same
 * one the action reads from) and set the `requireUser` override,
 * then invoke the handler and assert on the response shape:
 *   - 200 + text/csv on success
 *   - 401 on missing / invalid auth
 *   - Content-Disposition carries the filename
 */

interface RouteModule {
  GET: () => Promise<Response>;
}

async function callExport(): Promise<Response> {
  const mod = (await import("@/app/api/contacts/export/route")) as RouteModule;
  return mod.GET();
}

describe("GET /api/contacts/export", () => {
  let db: TestDb;

  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("returns 401 when the user override references a non-existent user", async () => {
    // The override points at user 99 which was never seeded —
    // requireUser should throw, and the route handler maps that to 401.
    // NOTE: we can't easily test the "no override, no cookie" path
    // here because the route handler runs `cookies()` from
    // `next/headers` outside of a Next.js request scope, which the
    // testing environment rejects with a different error. The
    // production behavior (no cookie → 401) is exercised through
    // the auth helper itself in `src/lib/auth` tests.
    __setCurrentUserIdForTests(99);
    const res = await callExport();
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns 200 + text/csv with the user's contacts", async () => {
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
    __setCurrentUserIdForTests(1);

    const res = await callExport();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");

    const body = await res.text();
    expect(body).toContain("phone,firstName,lastName,groupId");
    expect(body).toContain("+15551111111");
    expect(body).toContain("Alice");
    expect(body).toContain("+15552222222");
    expect(body).toContain("Bob");
  });

  it("includes the filename in Content-Disposition", async () => {
    __setCurrentUserIdForTests(1);
    const res = await callExport();
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="contacts-\d{8}-\d{4}\.csv"$/);
  });

  it("does not leak another user's contacts into the response", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
    });
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
    __setCurrentUserIdForTests(1);

    const res = await callExport();
    const body = await res.text();
    expect(body).toContain("+15551111111");
    expect(body).not.toContain("+15559999999");
    expect(body).not.toContain("Other");
  });

  it("returns 200 with just the header row for a user with no contacts", async () => {
    __setCurrentUserIdForTests(1);
    const res = await callExport();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("phone,firstName,lastName,groupId\n");
  });

  it("returns 401 when the user override references a non-existent user", async () => {
    // The override points at user 99 which was never seeded —
    // requireUser should throw, and the route handler maps that to 401.
    __setCurrentUserIdForTests(99);
    const res = await callExport();
    expect(res.status).toBe(401);
  });
});