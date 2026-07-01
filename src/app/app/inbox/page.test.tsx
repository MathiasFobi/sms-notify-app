import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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

// `useRouter` and `usePathname` are imported by the InboxSplit
// client component and require a Next.js app-router context.
// The page tests render the server-rendered page via
// `renderToStaticMarkup`, which doesn't mount a router. We stub
// the `next/navigation` module so the static-render path doesn't
// throw "invariant expected app router to be mounted".
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => undefined,
    push: () => undefined,
    back: () => undefined,
  }),
  usePathname: () => "/app/inbox",
}));

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
 *
 * The inbox page renders a split-pane (thread list on the left,
 * detail on the right) when there are messages. The test asserts
 * on the rendered structure (presence of the thread-list panel,
 * per-row testids, etc.) without simulating a click on a row —
 * the detail pane is selected by the first unread message by
 * default, which is what the seed sets up.
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
    // No thread list rendered.
    expect(html).not.toContain('data-testid="inbox-thread-list"');
  });

  it("renders the split-pane shell when the user has inbound messages", async () => {
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "Hello there",
      receivedAt: new Date("2026-06-29T08:00:00.000Z"),
    });

    const html = await renderPage();

    expect(html).toContain('data-testid="inbox-thread-list"');
    expect(html).toContain('data-testid="inbox-thread-detail"');
    expect(html).toContain("Hello there");
    expect(html).toContain("+15551111111");
  });

  it("lists inbound messages as thread rows, newest first", async () => {
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

    expect(html).toContain(`data-testid="inbox-thread-row-${newerId}"`);
    expect(html).toContain(`data-testid="inbox-thread-row-${olderId}"`);
    // Newer row appears before older row in the HTML.
    const newerIdx = html.indexOf(`data-testid="inbox-thread-row-${newerId}"`);
    const olderIdx = html.indexOf(`data-testid="inbox-thread-row-${olderId}"`);
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("auto-selects the first unread message in the detail pane", async () => {
    const readId = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "old read message",
      read: true,
      receivedAt: new Date("2026-06-29T07:00:00.000Z"),
    });
    const unreadId = await seedInbound(db, {
      userId: 1,
      fromPhone: "+15552222222",
      body: "newer unread message",
      receivedAt: new Date("2026-06-29T10:00:00.000Z"),
    });

    const html = await renderPage();

    // The detail body (in the right pane) should be the unread
    // message — the read message's body shows only in the list
    // row's preview.
    const detailIdx = html.indexOf('data-testid="inbox-detail-body"');
    expect(detailIdx).toBeGreaterThan(-1);
    const detailEnd = html.indexOf("</p>", detailIdx);
    expect(detailEnd).toBeGreaterThan(detailIdx);
    const detailSlice = html.slice(detailIdx, detailEnd);
    expect(detailSlice).toContain("newer unread message");
    // The two thread rows are both rendered in the list.
    expect(html).toContain(`data-testid="inbox-thread-row-${readId}"`);
    expect(html).toContain(`data-testid="inbox-thread-row-${unreadId}"`);
  });

  it("renders the reply form in the detail pane (with a sender ID seeded)", async () => {
    await db.insert("sender_ids", {
      user_id: 1,
      value: "+15550000099",
      status: "approved",
      created_at: new Date(),
    });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "ping",
    });

    const html = await renderPage();

    expect(html).toContain('data-testid="inbox-reply-body"');
    expect(html).toContain('data-testid="inbox-reply-send"');
    expect(html).toContain('data-testid="inbox-reply-from"');
  });

  it("renders the filter pills (All / Unread) with counts", async () => {
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15551111111",
      body: "unread 1",
    });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15552222222",
      body: "unread 2",
    });
    await seedInbound(db, {
      userId: 1,
      fromPhone: "+15553333333",
      body: "already read",
      read: true,
    });

    const html = await renderPage();

    expect(html).toContain('data-testid="inbox-filter-all"');
    expect(html).toContain('data-testid="inbox-filter-unread"');
    // The "All" pill should show 3 (total). The "Unread" pill should
    // show 2. Both numbers are in the pill text.
    const allIdx = html.indexOf('data-testid="inbox-filter-all"');
    const unreadIdx = html.indexOf('data-testid="inbox-filter-unread"');
    expect(allIdx).toBeLessThan(unreadIdx);
    const allSlice = html.slice(allIdx, allIdx + 200);
    const unreadSlice = html.slice(unreadIdx, unreadIdx + 200);
    expect(allSlice).toContain("(3)");
    expect(unreadSlice).toContain("(2)");
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
    const end = html.indexOf("</span>", start);
    expect(end).toBeGreaterThan(start);
    const slice = html.slice(start, end);
    expect(slice).toContain("2");
  });
});