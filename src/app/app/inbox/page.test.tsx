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
import {
  __resetTestDbForTests,
  getTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Render the /app/inbox page for an authenticated user.
 *
 * Strategy mirrors the sender-ids / scheduled / dev-webhooks page
 * tests:
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
  const mod = (await import("@/app/app/inbox/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

interface SeedInboundArgs {
  userId: number;
  fromPhone: string;
  body: string;
  receivedAt?: Date;
  read?: boolean;
}

async function seedInbound(
  db: TestDb,
  args: SeedInboundArgs,
): Promise<number> {
  const inserted = await db.insert("inbound_messages", {
    user_id: args.userId,
    from_phone: args.fromPhone,
    to_number: "+15550000001",
    body: args.body,
    twilio_message_sid: `SM_${Math.random().toString(36).slice(2, 10)}`,
    received_at: args.receivedAt,
    read: args.read ?? false,
  });
  return inserted.id as number;
}

describe("/app/inbox page", () => {
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
      twilio_from_number: "+15550000001",
    });
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header", async () => {
    const html = await renderPage();
    expect(html).toContain("Inbox");
  });

  it("shows the EmptyState primitive when the user has no inbound messages", async () => {
    const html = await renderPage();
    // EmptyState primitive exposes data-testid="empty-state" plus the
    // title text we pass in.
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain("No inbound messages yet");
    // No table rendered.
    expect(html).not.toContain("<table");
  });

  it("lists the user's inbound messages in a table", async () => {
    const id1 = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "Hello there",
      receivedAt: new Date("2026-06-29T08:00:00.000Z"),
    });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15552222222",
      body: "Second message",
      receivedAt: new Date("2026-06-29T09:00:00.000Z"),
    });

    const html = await renderPage();

    expect(html).toContain("<table");
    expect(html).toContain("+15551111111");
    expect(html).toContain("+15552222222");
    expect(html).toContain("Hello there");
    expect(html).toContain("Second message");
    // Each row exposes a data-testid.
    expect(html).toContain(`data-testid="inbox-row-${id1}"`);
  });

  it("sorts the table newest-first", async () => {
    const olderId = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "older",
      receivedAt: new Date("2026-06-29T07:00:00.000Z"),
    });
    const newerId = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15552222222",
      body: "newer",
      receivedAt: new Date("2026-06-29T10:00:00.000Z"),
    });

    const html = await renderPage();

    // The newer row should appear before the older one in the HTML.
    const newerIdx = html.indexOf(`data-testid="inbox-row-${newerId}"`);
    const olderIdx = html.indexOf(`data-testid="inbox-row-${olderId}"`);
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("renders a Mark read button per unread row", async () => {
    const id = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "unread message",
    });

    const html = await renderPage();

    expect(html).toContain(`data-testid="inbox-mark-read-form-${id}"`);
    expect(html).toContain(`data-testid="inbox-mark-read-button-${id}"`);
    expect(html).toContain("Mark read");
  });

  it("does not render a Mark read button for already-read rows", async () => {
    const id = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "already read",
      read: true,
    });

    const html = await renderPage();

    expect(html).not.toContain(`data-testid="inbox-mark-read-form-${id}"`);
    expect(html).not.toContain(`data-testid="inbox-mark-read-button-${id}"`);
    // Verify the row is still rendered with a "read" badge.
    expect(html).toContain(`data-testid="inbox-row-${id}"`);
    expect(html).toContain(`data-testid="inbox-status-${id}"`);
    // The status badge should display the text "read" (not "unread").
    // Walk forward from the status testid to the next </span> and
    // assert the inner text is "read".
    const start = html.indexOf(`data-testid="inbox-status-${id}"`);
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf("</span>", start);
    expect(end).toBeGreaterThan(start);
    const badgeHtml = html.slice(start, end);
    expect(badgeHtml).toContain("read");
    expect(badgeHtml).not.toContain("unread");
  });

  it("renders the Mark all read button when there is at least one unread row", async () => {
    await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
    const html = await renderPage();
    expect(html).toContain('data-testid="inbox-mark-all-form"');
    expect(html).toContain('data-testid="inbox-mark-all-button"');
  });

  it("does not render the Mark all read button when every row is read", async () => {
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "a",
      read: true,
    });
    const html = await renderPage();
    expect(html).not.toContain('data-testid="inbox-mark-all-form"');
  });

  it("does not leak another user's inbound messages", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
      twilio_from_number: "+15550000002",
    });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "alice msg",
    });
    await seedInbound(db, {
      userId: 2,
      fromPhone: "+15552222222",
      body: "bob private msg",
    });

    const html = await renderPage();

    expect(html).toContain("alice msg");
    expect(html).toContain("+15551111111");
    expect(html).not.toContain("bob private msg");
    expect(html).not.toContain("+15552222222");
  });

  it("surfaces the unread count in the header", async () => {
    await seedInbound(db, { userId: 1, fromPhone: "+15551111111", body: "a" });
    await seedInbound(db, { userId: 1, fromPhone: "+15552222222", body: "b" });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15553333333",
      body: "c",
      read: true,
    });

    const html = await renderPage();

    // Locate the <span data-testid="inbox-unread-count">...</span>
    // and confirm it contains the digit "2" (we seeded 2 unread + 1 read).
    const start = html.indexOf('data-testid="inbox-unread-count"');
    expect(start).toBeGreaterThan(-1);
    // Walk forward to the next </span> after the opening tag.
    const end = html.indexOf("</span>", start);
    expect(end).toBeGreaterThan(start);
    const slice = html.slice(start, end);
    expect(slice).toContain("2");
  });
});