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
 * Render the /app/contacts page for an authenticated user.
 *
 * Strategy mirrors `src/app/app/sender-ids/page.test.tsx`:
 *   1. Reset the singleton DB and seed a user + contact groups.
 *   2. Set the `requireUser` override to that user.
 *   3. Import the page module dynamically (so `next/headers` /
 *      `requireUser` deps don't bleed into module load).
 *   4. `renderToStaticMarkup(await Page())` and assert on the HTML.
 *
 * Page tests focus on the render shape (header, create form, group
 * list, empty-state, cross-user isolation). The action logic itself
 * is covered exhaustively in `src/lib/actions/contact-groups.test.ts`.
 */

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/contacts/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

describe("/app/contacts page", () => {
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

  it("renders the page header and create-group form", async () => {
    const html = await renderPage();

    expect(html).toContain("Contacts");
    expect(html).toContain("Contact groups");
    expect(html).toContain('name="name"'); // the create-group input
    expect(html).toContain("Create group"); // the submit button label
  });

  it("renders the empty-state copy when the user has no groups", async () => {
    const html = await renderPage();
    expect(html).toContain("No contact groups yet");
    // When there are no groups we render the dashed empty-state panel
    // instead of the Table; the heading "Your groups" is still shown
    // so the section label is consistent.
    expect(html).not.toContain("<table");
  });

  it("lists the user's contact groups in the table with rename + delete controls", async () => {
    await db.insert("contact_groups", { user_id: 1, name: "Customers" });
    await db.insert("contact_groups", { user_id: 1, name: "Event attendees" });

    const html = await renderPage();
    expect(html).toContain("Customers");
    expect(html).toContain("Event attendees");
    // Each row renders a rename form (with a defaultValue input) and
    // a delete form. Check that the action buttons show up.
    expect(html).toContain(">Rename<");
    expect(html).toContain(">Delete<");
    // And the rename inputs are pre-populated with the current name.
    expect(html).toContain('value="Customers"');
    expect(html).toContain('value="Event attendees"');
  });

  it("does not leak another user's groups into the table", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
    });
    await db.insert("contact_groups", {
      user_id: 2,
      name: "BobsSecretGroup",
    });
    await db.insert("contact_groups", {
      user_id: 1,
      name: "AlicesGroup",
    });

    const html = await renderPage();
    expect(html).toContain("AlicesGroup");
    expect(html).not.toContain("BobsSecretGroup");
  });

  it("shows the contacts placeholder section", async () => {
    const html = await renderPage();
    // The contacts table lands in US-008; for US-007 the page renders
    // a dashed placeholder panel so users see the full page layout.
    expect(html).toContain("No contacts yet");
    expect(html).toContain("coming in a later story");
  });
});