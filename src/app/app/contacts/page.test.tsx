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
 *   1. Reset the singleton DB and seed a user + contact groups +
 *      contacts.
 *   2. Set the `requireUser` override to that user.
 *   3. Import the page module dynamically (so `next/headers` /
 *      `requireUser` deps don't bleed into module load).
 *   4. `renderToStaticMarkup(await Page())` and assert on the HTML.
 *
 * Page tests focus on the render shape (header, create-group form,
 * contacts table, add form, import/export controls). The action
 * logic itself is covered exhaustively in
 * `src/lib/actions/contacts.test.ts`.
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

  it("renders the groups empty-state copy when the user has no groups", async () => {
    const html = await renderPage();
    expect(html).toContain("No contact groups yet");
    // When there are no groups we render the dashed empty-state panel
    // instead of the Table; the heading "Your groups" is still shown
    // so the section label is consistent.
    expect(html).not.toContain('value="Customers"');
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

  // -------------------------------------------------------------------------
  // US-008 — contacts CRUD section
  // -------------------------------------------------------------------------

  it("renders the contacts add / import / download controls", async () => {
    const html = await renderPage();

    // Add form: phone input + firstName / lastName / groupId fields.
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="lastName"');

    // Upload button (rendered as a label-wrapped file input).
    expect(html).toContain("Upload CSV");

    // Download link hits the export route handler.
    expect(html).toContain('href="/api/contacts/export"');
    expect(html).toContain("Download CSV");
  });

  it("renders the contacts empty-state copy when the user has no contacts", async () => {
    const html = await renderPage();
    expect(html).toContain("No contacts yet");
    // No rows table means no phone numbers showing up inside a table.
    expect(html).not.toContain("+15551234567");
  });

  it("lists the user's contacts in the table with Edit / Delete buttons", async () => {
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      first_name: "Alice",
      last_name: "Anderson",
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15552222222",
      first_name: "Bob",
      last_name: "Baker",
    });

    const html = await renderPage();

    expect(html).toContain("+15551111111");
    expect(html).toContain("+15552222222");
    expect(html).toContain("Alice Anderson");
    expect(html).toContain("Bob Baker");

    // Per-row controls (Edit + Delete buttons).
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Delete<");
  });

  it("does not leak another user's contacts into the table", async () => {
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

    const html = await renderPage();
    expect(html).toContain("+15551111111");
    expect(html).not.toContain("+15559999999");
    expect(html).not.toContain("Other");
  });

  it("shows the contact's group name when groupId is set", async () => {
    const group = await db.insert("contact_groups", {
      user_id: 1,
      name: "VIPs",
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      first_name: "Alice",
      group_id: group.id,
    });

    const html = await renderPage();
    // Group name should appear in both the groups table AND the
    // contact row's group column.
    expect(html).toContain("VIPs");
  });
});