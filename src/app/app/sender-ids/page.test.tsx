import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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
 * Render the /app/sender-ids page for an authenticated user.
 *
 * Strategy: the page calls `requireUser()` (cookie-based) and `getTestDb()`
 * (singleton). To exercise it without a real Next request, we:
 *   1. Reset the singleton DB and seed a user + sender IDs.
 *   2. Set the `requireUser` override to that user.
 *   3. Import the page module dynamically (so the action-side
 *      `__setCurrentUserIdForTests` test seam is exercised via the
 *      requireUser call).
 *   4. `renderToStaticMarkup(await Page())` and assert on the HTML.
 *
 * We use dynamic `import()` because importing the page module pulls
 * in `next/headers` (transitively via `requireUser`); keeping the
 * import inside the test body ensures the module-level imports in
 * this file don't accidentally crash the test runner.
 */

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/sender-ids/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("/app/sender-ids page", () => {
  let db: TestDb;

  beforeEach(async () => {
    // Reset both the test-DB singleton and the requireUser override so
    // every test starts from a clean slate. The page itself calls
    // `getTestDb()` and `requireUser()` directly, so we must seed
    // through the singleton — using a fresh `createTestDb()` would
    // create a DB that the page never sees.
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header and request form for an authenticated user", async () => {
    const html = await renderPage();

    expect(html).toContain("Sender IDs");
    expect(html).toContain("Request a new sender ID");
    expect(html).toContain('name="value"'); // the request form input
    expect(html).toContain(">Request<"); // the submit button label
  });

  it("renders the empty-state copy when the user has no sender IDs", async () => {
    const html = await renderPage();
    expect(html).toContain("No sender IDs yet");
    // When there are no rows we render the dashed empty-state panel
    // instead of the Table; column labels live inside the Table and
    // are covered by the "lists the user's sender IDs" test below.
    expect(html).not.toContain("<table");
  });

  it("lists the user's sender IDs in the table", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "BrandOne",
      status: "approved",
    });
    await db.insert("sender_ids", {
      user_id: 1,
      value: "BrandTwo",
      status: "pending",
    });

    const html = await renderPage();
    expect(html).toContain("BrandOne");
    expect(html).toContain("BrandTwo");
    expect(html).toContain("approved");
    expect(html).toContain("pending");
  });

  it("does not leak another user's sender IDs into the table", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
    });
    await db.insert("sender_ids", {
      user_id: 2,
      value: "BobsSecretSender",
      status: "approved",
    });
    await db.insert("sender_ids", {
      user_id: 1,
      value: "AlicesSender",
      status: "approved",
    });

    const html = await renderPage();
    expect(html).toContain("AlicesSender");
    expect(html).not.toContain("BobsSecretSender");
  });

  it("marks the user's current default sender ID", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15551234567",
      status: "approved",
    });
    await db.update("users", { id: 1 }, { twilio_from_number: "+15551234567" });

    const html = await renderPage();
    expect(html).toContain("Default");
    expect(html).toContain("+15551234567");
  });
});