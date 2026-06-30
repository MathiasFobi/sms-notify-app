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
 * Render the /app/scheduled page for an authenticated user.
 *
 * Strategy mirrors the sender-ids / send / contacts page tests:
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
  const mod = (await import("@/app/app/scheduled/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
}

interface SeedScheduledArgs {
  userId: number;
  body: string;
  to: string;
  scheduledFor: Date;
  status?: "scheduled" | "cancelled";
}

/**
 * Insert a `messages` row + matching `message_recipients` row directly
 * via the shim. We bypass `__scheduleSmsInternal` because:
 *   - we want to seed BOTH scheduled AND cancelled rows (cancel would
 *     normally start as scheduled);
 *   - we want a past `scheduledFor` (some tests need to verify sorting).
 */
async function seedScheduledMessage(
  db: TestDb,
  args: SeedScheduledArgs,
): Promise<{ messageId: number }> {
  const inserted = await db.insert("messages", {
    user_id: args.userId,
    body: args.body,
    from_number: "+15550000001",
    status: args.status ?? "scheduled",
    cost_credits: 1,
    scheduled_for: args.scheduledFor,
  });
  const messageId = inserted.id as number;
  await db.insert("message_recipients", {
    message_id: messageId,
    phone: args.to,
    status: "pending",
  });
  return { messageId };
}

describe("/app/scheduled page", () => {
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
    expect(html).toContain("Scheduled messages");
  });

  it("shows an empty-state message when the user has no scheduled messages", async () => {
    const html = await renderPage();
    expect(html).toContain("No scheduled or cancelled messages yet");
  });

  it("lists the user's scheduled messages in a table", async () => {
    const future = new Date("2026-07-01T10:00:00.000Z");
    await seedScheduledMessage(db, {
      userId: 1,
      body: "Reminder: meeting at noon",
      to: "+15551234567",
      scheduledFor: future,
    });

    const html = await renderPage();

    // Recipient phone + body show up.
    expect(html).toContain("+15551234567");
    expect(html).toContain("Reminder: meeting at noon");
    // Status badge reads "scheduled".
    expect(html).toContain(">scheduled<");
    // Cancel button is rendered (testid encodes the message id).
    expect(html).toMatch(/data-testid="scheduled-cancel-button-\d+"/);
  });

  it("does not render a Cancel button for cancelled messages", async () => {
    const future = new Date("2026-07-01T10:00:00.000Z");
    const { messageId } = await seedScheduledMessage(db, {
      userId: 1,
      body: "Already cancelled",
      to: "+15551234567",
      scheduledFor: future,
      status: "cancelled",
    });

    const html = await renderPage();

    expect(html).toContain(">cancelled<");
    // The status badge for this row exists...
    expect(html).toContain(`data-testid="scheduled-status-${messageId}"`);
    // ...but no Cancel form for it.
    expect(html).not.toContain(
      `data-testid="scheduled-cancel-form-${messageId}"`,
    );
  });

  it("does not leak another user's scheduled messages", async () => {
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
      twilio_from_number: "+15550000002",
    });
    await seedScheduledMessage(db, {
      userId: 1,
      body: "Alice message body",
      to: "+15551111111",
      scheduledFor: new Date("2026-07-01T10:00:00.000Z"),
    });
    await seedScheduledMessage(db, {
      userId: 2,
      body: "Bob message body",
      to: "+15552222222",
      scheduledFor: new Date("2026-07-02T10:00:00.000Z"),
    });

    const html = await renderPage();

    expect(html).toContain("Alice message body");
    expect(html).toContain("+15551111111");
    expect(html).not.toContain("Bob message body");
    expect(html).not.toContain("+15552222222");
  });

  it("lists both scheduled AND cancelled messages for the user", async () => {
    await seedScheduledMessage(db, {
      userId: 1,
      body: "Queued",
      to: "+15551111111",
      scheduledFor: new Date("2026-07-01T10:00:00.000Z"),
      status: "scheduled",
    });
    await seedScheduledMessage(db, {
      userId: 1,
      body: "Cancelled",
      to: "+15552222222",
      scheduledFor: new Date("2026-07-02T10:00:00.000Z"),
      status: "cancelled",
    });

    const html = await renderPage();

    expect(html).toContain("Queued");
    expect(html).toContain("Cancelled");
    // Two rows in the tbody.
    const rowMatches = html.match(/data-testid="scheduled-row-\d+"/g);
    expect(rowMatches).not.toBeNull();
    expect(rowMatches!.length).toBe(2);
  });

  it("does not include sent / failed messages in the scheduled view", async () => {
    await seedScheduledMessage(db, {
      userId: 1,
      body: "sent msg",
      to: "+15551111111",
      scheduledFor: new Date("2026-07-01T10:00:00.000Z"),
      status: "scheduled",
    });
    // Insert a sent message directly via the shim — the page should
    // not surface it.
    await db.insert("messages", {
      user_id: 1,
      body: "already sent",
      from_number: "+15550000001",
      status: "sent",
      cost_credits: 1,
    });

    const html = await renderPage();
    expect(html).not.toContain("already sent");
    expect(html).toContain("sent msg");
  });
});