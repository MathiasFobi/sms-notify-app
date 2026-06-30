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
 * Render the /app/send page for an authenticated user.
 *
 * Strategy mirrors the sender-ids / contacts page tests:
 *   1. Reset the singleton DB and seed a user + sender IDs.
 *   2. Set the `requireUser` override to that user.
 *   3. Import the page module dynamically (so `next/headers` /
 *      `requireUser` deps don't bleed into module load).
 *   4. `renderToStaticMarkup(await Page())` and assert on the HTML.
 */

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/send/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("/app/send page", () => {
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
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header and form scaffolding", async () => {
    // Seed at least one sender id so the <select> renders instead
    // of the empty-state hint.
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15550000001",
      status: "approved",
    });

    const html = await renderPage();

    expect(html).toContain("Send an SMS");
    expect(html).toContain('name="to"'); // recipient input
    expect(html).toContain('name="body"'); // body textarea
    expect(html).toContain('name="fromNumber"'); // sender id select
    expect(html).toContain("Send SMS"); // submit button label
  });

  it("renders both the single-send and bulk-send tabs by default", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15550000001",
      status: "approved",
    });

    const html = await renderPage();

    // Both tabs are visible.
    expect(html).toContain("Single send");
    expect(html).toContain("Bulk send (CSV)");
    expect(html).toContain('data-testid="send-tab-single"');
    expect(html).toContain('data-testid="send-tab-bulk"');
  });

  it("defaults to the single-send panel on first render", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15550000001",
      status: "approved",
    });

    const html = await renderPage();

    // The single-send panel is mounted (has 'name="to"'); the bulk-send
    // panel is NOT mounted (no 'name="csv"' file input).
    expect(html).toContain('data-testid="send-panel-single"');
    expect(html).toContain('name="to"');
    expect(html).not.toContain('name="csv"');
    expect(html).not.toContain('data-testid="bulk-csv-input"');
  });

  it("renders the character counter at 0 / 1600 on first render", async () => {
    const html = await renderPage();
    expect(html).toContain("0 / 1600");
  });

  it("lists the user's sender IDs in the <select> options", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "MyBrand",
      status: "approved",
    });
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15551234567",
      status: "pending",
    });

    const html = await renderPage();

    expect(html).toContain("MyBrand");
    expect(html).toContain("+15551234567");
  });

  it("preselects the user's default from-number", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "MyBrand",
      status: "approved",
    });
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15551234567",
      status: "approved",
    });
    await db.update("users", { id: 1 }, { twilio_from_number: "+15551234567" });

    const html = await renderPage();

    // The default <option> for the user's default sender id should
    // have `selected` on it.
    expect(html).toMatch(
      /<option[^>]*value="\+15551234567"[^>]*selected[^>]*>/,
    );
  });

  it("shows the empty-state hint when the user has no sender IDs", async () => {
    const html = await renderPage();
    expect(html).toContain("No sender IDs registered");
    expect(html).toContain("/app/sender-ids"); // link to register
  });

  it("does not leak another user's sender IDs into the select", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
    });
    await db.insert("sender_ids", {
      user_id: 1,
      value: "AliceBrand",
      status: "approved",
    });
    await db.insert("sender_ids", {
      user_id: 2,
      value: "BobBrand",
      status: "approved",
    });

    const html = await renderPage();
    expect(html).toContain("AliceBrand");
    expect(html).not.toContain("BobBrand");
  });
});