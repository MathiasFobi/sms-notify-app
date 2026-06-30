import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import { __resetTestDbForTests, getTestDb, type TestDb } from "@/test/db";

/**
 * Render the /app/settings page for an authenticated user.
 *
 * Strategy mirrors the other /app/* page tests:
 *   1. Reset the singleton DB and seed a user.
 *   2. Set the `requireUser` override to that user.
 *   3. Import the page module dynamically so its `next/headers` /
 *      `requireUser` deps don't bleed into module load.
 *   4. `renderToStaticMarkup(await Page())` and assert on the HTML.
 */

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/settings/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

interface SeedUserArgs {
  id: number;
  name?: string;
  twilioFromNumber?: string | null;
}

async function seedUser(db: TestDb, args: SeedUserArgs): Promise<void> {
  await db.insert("users", {
    id: args.id,
    email: `u${args.id}@example.com`,
    password_hash: "x",
    name: args.name ?? `User ${args.id}`,
    twilio_from_number: args.twilioFromNumber ?? null,
  });
}

interface SeedSenderIdArgs {
  userId: number;
  value: string;
  status?: "approved" | "pending" | "rejected";
}

async function seedSenderId(db: TestDb, args: SeedSenderIdArgs): Promise<number> {
  const inserted = await db.insert("sender_ids", {
    user_id: args.userId,
    value: args.value,
    status: args.status ?? "approved",
  });
  return inserted.id as number;
}

describe("/app/settings page (US-018)", () => {
  let db: TestDb;

  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await seedUser(db, { id: 1, name: "Alice" });
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header", async () => {
    const html = await renderPage();
    expect(html).toContain("Settings");
  });

  it("renders the profile section with the current name in the input", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="settings-profile-section"');
    // The current name is seeded as the input's defaultValue.
    expect(html).toContain('id="settings-profile-name"');
    expect(html).toContain('value="Alice"');
  });

  it("renders the default-sender-id section with the empty-state copy when no approved sender ids exist", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="settings-default-sender-id-section"');
    // No <select> should be rendered — the empty-state copy replaces it.
    expect(html).not.toContain('id="settings-default-sender-id"');
    expect(html).toContain("don&#x27;t have any approved sender IDs");
  });

  it("renders the approved sender IDs as <option>s in the default-sender-id <select>", async () => {
    await seedSenderId(db, { userId: 1, value: "+15551111111", status: "approved" });
    await seedSenderId(db, { userId: 1, value: "+15552222222", status: "approved" });
    // A pending row must NOT be offered as an option.
    await seedSenderId(db, { userId: 1, value: "PendingOne", status: "pending" });

    const html = await renderPage();
    expect(html).toContain('id="settings-default-sender-id"');
    expect(html).toContain("+15551111111");
    expect(html).toContain("+15552222222");
    // The pending value should not be present in the select options.
    // (It could appear in the page elsewhere, but it MUST NOT be inside
    // the <select>.) We assert against the select block by finding its
    // closing </select> tag and verifying the pending value isn't in it.
    const selectStart = html.indexOf('id="settings-default-sender-id"');
    const selectEnd = html.indexOf("</select>", selectStart);
    expect(selectStart).toBeGreaterThan(-1);
    expect(selectEnd).toBeGreaterThan(selectStart);
    const selectHtml = html.slice(selectStart, selectEnd);
    expect(selectHtml).not.toContain("PendingOne");
    // Always offer "No default" so the user can clear the default.
    expect(selectHtml).toContain(">No default<");
  });

  it("preselects the current default sender ID in the <select>", async () => {
    await db.update(
      "users",
      { id: 1 },
      { twilio_from_number: "+15552222222" },
    );
    await seedSenderId(db, { userId: 1, value: "+15551111111", status: "approved" });
    const chosenId = await seedSenderId(db, {
      userId: 1,
      value: "+15552222222",
      status: "approved",
    });

    const html = await renderPage();
    // The select's defaultValue should match the row id whose value
    // is the current default. The closest <option> with that id is
    // marked selected.
    expect(html).toMatch(
      new RegExp(`<option[^>]*value="${chosenId}"[^>]*selected`),
    );
  });

  it("renders the current name as the input's defaultValue", async () => {
    // Update the row that beforeEach already seeded — calling seedUser
    // again with the same id would fail because the shim's insert
    // doesn't dedupe.
    await db.update("users", { id: 1 }, { name: "Renamed Alice" });
    const html = await renderPage();
    expect(html).toContain('value="Renamed Alice"');
  });

  it("renders both form submit buttons", async () => {
    await seedSenderId(db, { userId: 1, value: "+15551111111", status: "approved" });
    const html = await renderPage();
    // Each form has its own submit button labeled "Save".
    const saveButtons = html.match(/<button[^>]*type="submit"/g) ?? [];
    expect(saveButtons.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('id="settings-profile-name-form"');
    expect(html).toContain('id="settings-default-sender-id-form"');
  });

  it("does not leak another user's approved sender IDs into the <select>", async () => {
    await seedUser(db, { id: 2, name: "Bob" });
    await seedSenderId(db, { userId: 1, value: "+15551111111", status: "approved" });
    await seedSenderId(db, { userId: 2, value: "+15559999999", status: "approved" });

    const html = await renderPage();
    expect(html).toContain("+15551111111");
    // The select block must not contain Bob's value.
    const selectStart = html.indexOf('id="settings-default-sender-id"');
    const selectEnd = html.indexOf("</select>", selectStart);
    const selectHtml = html.slice(selectStart, selectEnd);
    expect(selectHtml).not.toContain("+15559999999");
  });

  it("orders the approved sender IDs alphabetically in the <select>", async () => {
    await seedSenderId(db, { userId: 1, value: "BravoCo", status: "approved" });
    await seedSenderId(db, { userId: 1, value: "AlphaCo", status: "approved" });
    await seedSenderId(db, { userId: 1, value: "CharlieCo", status: "approved" });

    const html = await renderPage();
    const selectStart = html.indexOf('id="settings-default-sender-id"');
    const selectEnd = html.indexOf("</select>", selectStart);
    const selectHtml = html.slice(selectStart, selectEnd);
    const alphaIdx = selectHtml.indexOf("AlphaCo");
    const bravoIdx = selectHtml.indexOf("BravoCo");
    const charlieIdx = selectHtml.indexOf("CharlieCo");
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(bravoIdx).toBeGreaterThan(alphaIdx);
    expect(charlieIdx).toBeGreaterThan(bravoIdx);
  });
});