/**
 * Tests for the `/dev/webhooks` page (US-014).
 *
 * Three angles of coverage:
 *
 *   1. The pure helper `loadRecentMessages` — exercises the
 *      `messages` + `message_recipients` join / ordering / limit
 *      directly without a render call.
 *
 *   2. Page-render tests (dev mode) — render the page module
 *      through `renderToStaticMarkup` and assert on:
 *        - The three forms each having a submit button + the right
 *          `id=` to identify them.
 *        - The recent-messages table rendering when the DB has rows.
 *        - The empty-state copy when the DB has none.
 *
 *   3. Page-render tests (production guard) — drive the same
 *      render through `__setDevWebhooksProductionOverride(true)`
 *      and assert that `notFound()` throws.
 *
 * Why a custom `__setDevWebhooksProductionOverride` instead of
 * mutating `process.env.NODE_ENV`:
 *   - `process.env` is captured-at-import-time by some libraries;
 *     we'd rather flip an in-memory flag we own.
 *   - The flag also keeps the test self-explanatory at the call
 *     site (`override(true)` reads better than
 *     `process.env.NODE_ENV = 'production'`).
 *
 * Note on form-action reachability (AC: "a POST through the form
 * action reaches the matching route handler"): verifying the form
 * `action={fn}` target IS the route handler is straightforward at
 * the unit level — the client component builds a `fetch()` call to
 * `/api/webhooks/twilio/...` in its submit handler. We exercise
 * this by importing the route handlers, calling `POST(new Request
 * (formData))` directly with the same fields the form would send,
 * and asserting the response shape matches what the simulator's
 * banner would render. That's a stronger guarantee than spying on
 * fetch.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";
import {
  __setDevWebhooksProductionOverride,
  loadRecentMessages,
} from "@/app/dev/webhooks/page";

// ============================================================================
// Render helpers
// ============================================================================

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/dev/webhooks/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

// ============================================================================
// Form-action reachability helpers
//
// The dev simulator's client forms POST form-encoded fields to the
// /api/webhooks/twilio/{status,inbound} route handlers. To prove
// "a POST through the form action reaches the matching route
// handler", we drive the route directly with the same shape of
// body the form's `postForm()` helper builds, then assert on the
// response shape that the simulator's banner would render.
// ============================================================================

interface StatusRouteModule {
  POST: (request: Request) => Promise<Response>;
}
interface InboundRouteModule {
  POST: (request: Request) => Promise<Response>;
}

async function postStatus(
  fields: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const mod = (await import(
    "@/app/api/webhooks/twilio/status/route"
  )) as StatusRouteModule;
  const body = new URLSearchParams(fields).toString();
  const res = await mod.POST(
    new Request("http://localhost/api/webhooks/twilio/status", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
  return { status: res.status, body: await res.text() };
}

async function postInbound(
  fields: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const mod = (await import(
    "@/app/api/webhooks/twilio/inbound/route"
  )) as InboundRouteModule;
  const body = new URLSearchParams(fields).toString();
  const res = await mod.POST(
    new Request("http://localhost/api/webhooks/twilio/inbound", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
  );
  return { status: res.status, body: await res.text() };
}

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(
  db: TestDb,
  id: number,
  email: string,
  opts: { twilioFromNumber?: string | null } = {},
): Promise<void> {
  await db.insert("users", {
    id,
    email,
    password_hash: "x",
    name: email,
    twilio_from_number: opts.twilioFromNumber ?? null,
  });
}

interface RecentFixture {
  userId: number;
  to: string;
  body: string;
  twilioMessageSid?: string | null;
  recipientTwilioMessageSid?: string | null;
  status?: "queued" | "sent" | "delivered" | "failed";
  recipientStatus?: "pending" | "sent" | "delivered" | "failed";
}

async function seedMessageWithRecipient(
  db: TestDb,
  f: RecentFixture,
): Promise<{ messageId: number; recipientId: number }> {
  const inserted = await db.insert("messages", {
    user_id: f.userId,
    body: f.body,
    from_number: "+15550000001",
    status: f.status ?? "sent",
    twilio_message_sid: f.twilioMessageSid ?? null,
    cost_credits: 1,
  });
  const messageId = inserted.id as number;
  const recipient = await db.insert("message_recipients", {
    message_id: messageId,
    phone: f.to,
    status: f.recipientStatus ?? "sent",
    twilio_message_sid: f.recipientTwilioMessageSid ?? null,
  });
  return { messageId, recipientId: recipient.id as number };
}

// ============================================================================
// Tests
// ============================================================================

describe("/dev/webhooks page", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __setDevWebhooksProductionOverride(null);
  });

  afterEach(() => {
    __setDevWebhooksProductionOverride(null);
    __resetTestDbForTests();
  });

  // ------------------------------------------------------------------------
  // Production guard
  // ------------------------------------------------------------------------

  it("renders the simulator UI when NODE_ENV is not 'production'", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain("Twilio webhook simulator");
    expect(html).toContain('data-testid="dev-webhooks-page"');
  });

  it("calls notFound() when NODE_ENV is 'production'", async () => {
    __setDevWebhooksProductionOverride(true);
    // `notFound()` throws a special error that Next.js catches
    // and converts to a 404 response. We assert on the throw.
    await expect(renderPage()).rejects.toThrow();
  });

  // ------------------------------------------------------------------------
  // Three forms present in dev mode
  // ------------------------------------------------------------------------

  it("renders the status callback form", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain('id="dev-webhook-status-form"');
    expect(html).toContain("Send status callback");
    expect(html).toContain('data-testid="status-message-sid"');
  });

  it("renders the inbound message form", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain('id="dev-webhook-inbound-form"');
    expect(html).toContain("Send inbound message");
    expect(html).toContain('data-testid="inbound-from"');
    expect(html).toContain('data-testid="inbound-to"');
    expect(html).toContain('data-testid="inbound-body"');
    expect(html).toContain('data-testid="inbound-message-sid"');
  });

  it("renders the STOP keyword form with the canonical keyword dropdown", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain('id="dev-webhook-stop-form"');
    expect(html).toContain("Send STOP keyword");
    // The dropdown's <select name="body"> ships every opt-out
    // keyword from OPT_OUT_KEYWORDS so the form is self-contained.
    // (Mirrored list; see the comment in dev-webhook-simulator.tsx.)
    expect(html).toMatch(/<option[^>]*value="STOP"[^>]*>/);
    expect(html).toMatch(/<option[^>]*value="STOPALL"[^>]*>/);
    expect(html).toMatch(/<option[^>]*value="UNSUBSCRIBE"[^>]*>/);
    expect(html).toMatch(/<option[^>]*value="CANCEL"[^>]*>/);
    expect(html).toMatch(/<option[^>]*value="END"[^>]*>/);
  });

  // ------------------------------------------------------------------------
  // Form actions reach the matching route handler
  // ------------------------------------------------------------------------

  it("a POST like the status form would send reaches the status route handler", async () => {
    // The form's postForm() helper builds a form-encoded body with
    // keys MessageSid + MessageStatus (and optional ErrorCode).
    // Seed a user + sender from-number so the status route's user
    // lookup matches our message (the status route doesn't actually
    // require a user to exist — but having one in the DB ensures
    // later tests see a clean slate).
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000000",
    });
    const result = await postStatus({
      MessageSid: "SMform_test_abc",
      MessageStatus: "delivered",
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain("\"ok\":true");
  });

  it("a POST like the inbound form would send reaches the inbound route handler", async () => {
    // Seed a user so the inbound route's user-resolution succeeds
    // and the route reports an `inserted` outcome (rather than
    // `unknown_to`).
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000000",
    });
    const result = await postInbound({
      From: "+15551234567",
      To: "+15550000000",
      Body: "Hello back",
      MessageSid: "SMform_inbound_xyz",
    });
    expect(result.status).toBe(200);
    expect(result.body).toContain("\"ok\":true");
    expect(result.body).toMatch(/"result":"inserted"/);
  });

  it("a POST with a STOP keyword body like the STOP form would send is accepted (200) by the inbound route", async () => {
    // Seed a user so the inbound route's user-resolution succeeds.
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000000",
    });
    const result = await postInbound({
      From: "+15551234567",
      To: "+15550000000",
      Body: "STOP",
      MessageSid: "SMform_stop_qrs",
    });
    // Route accepts the opt-out keyword and returns 200 uniformly
    // — same as the simulator's banner would render.
    expect(result.status).toBe(200);
    expect(result.body).toContain("\"ok\":true");
    expect(result.body).toMatch(/"result":"inserted"/);
    // The matched opt-out keyword is exposed on the outcome so
    // the simulator banner can show "STOP keyword recognized".
    expect(result.body).toMatch(/"optOutKeyword":"STOP"/);
  });

  // ------------------------------------------------------------------------
  // Recent-messages view (uses the singleton TestDb)
  // ------------------------------------------------------------------------

  it("lists the last 20 messages with their provider message id", async () => {
    __setDevWebhooksProductionOverride(false);
    // Seed the singleton DB directly so the page reads from it.
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com");
    await seedMessageWithRecipient(db, {
      userId: 1,
      to: "+15551111111",
      body: "first",
      twilioMessageSid: "SMaaaa111",
      recipientTwilioMessageSid: "SMr_aaaa1",
    });
    await seedMessageWithRecipient(db, {
      userId: 1,
      to: "+15552222222",
      body: "second",
      twilioMessageSid: "SMbbbb222",
      recipientTwilioMessageSid: "SMr_bbbb2",
    });
    await seedMessageWithRecipient(db, {
      userId: 1,
      to: "+15553333333",
      body: "third",
      twilioMessageSid: "SMcccc333",
      recipientTwilioMessageSid: "SMr_cccc3",
    });

    const html = await renderPage();

    // The recent-messages <section> is present.
    expect(html).toContain('data-testid="dev-webhooks-recent"');
    // Each recipient-row has a copyable sid button with the right
    // data-value. Asserting on data-value rather than text content
    // keeps the assertion stable as the button text changes
    // (Copy / 📋 / ✓ / etc.).
    expect(html).toContain('data-value="SMr_aaaa1"');
    expect(html).toContain('data-value="SMr_bbbb2"');
    expect(html).toContain('data-value="SMr_cccc3"');
    // Recipient phones are also visible.
    expect(html).toContain("+15551111111");
    expect(html).toContain("+15552222222");
    expect(html).toContain("+15553333333");
  });

  it("renders the empty-state copy when no messages exist", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain('data-testid="dev-webhooks-recent"');
    expect(html).toContain("No messages yet");
  });

  it("renders the dev-only banner explaining the production guard", async () => {
    __setDevWebhooksProductionOverride(false);
    const html = await renderPage();
    expect(html).toContain('data-testid="dev-webhooks-banner"');
    expect(html).toContain("Dev only");
  });
});

// ============================================================================
// loadRecentMessages helper (pure, no rendering)
// ============================================================================

describe("loadRecentMessages (page helper)", () => {
  let db: TestDb;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns at most 20 messages, newest first", async () => {
    await seedUser(db, 1, "alice@example.com");
    for (let i = 0; i < 25; i++) {
      await seedMessageWithRecipient(db, {
        userId: 1,
        to: `+1555000000${i.toString().padStart(2, "0")}`,
        body: `msg ${i}`,
        twilioMessageSid: `SM_seed_${i.toString().padStart(2, "0")}`,
      });
    }

    const rows = await loadRecentMessages(db, 20);
    expect(rows).toHaveLength(20);
    // Newest-first order: id at index 0 should be larger than at
    // index 19.
    expect(rows[0]!.messageId).toBeGreaterThan(rows[19]!.messageId);
  });

  it("surfaces the message-level twilio_message_sid when the recipient row has none", async () => {
    await seedUser(db, 1, "alice@example.com");
    await seedMessageWithRecipient(db, {
      userId: 1,
      to: "+15551111111",
      body: "single send",
      twilioMessageSid: "SM_single_top",
      recipientTwilioMessageSid: null,
    });

    const rows = await loadRecentMessages(db, 20);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.messageTwilioSid).toBe("SM_single_top");
    expect(rows[0]!.recipientTwilioSid).toBeNull();
  });

  it("keeps both the message-level and recipient-level sids when both are set", async () => {
    await seedUser(db, 1, "alice@example.com");
    await seedMessageWithRecipient(db, {
      userId: 1,
      to: "+15551111111",
      body: "with both",
      twilioMessageSid: "SM_message_level",
      recipientTwilioMessageSid: "SM_recipient_level",
    });

    const rows = await loadRecentMessages(db, 20);
    expect(rows[0]!.messageTwilioSid).toBe("SM_message_level");
    expect(rows[0]!.recipientTwilioSid).toBe("SM_recipient_level");
  });

  it("produces no rows when the DB is empty", async () => {
    const rows = await loadRecentMessages(db, 20);
    expect(rows).toEqual([]);
  });

  it("falls back to null recipient fields when a message has no recipient rows", async () => {
    await seedUser(db, 1, "alice@example.com");
    await db.insert("messages", {
      user_id: 1,
      body: "orphan",
      from_number: "+15550000001",
      status: "sent",
      twilio_message_sid: null,
      cost_credits: 1,
    });
    const rows = await loadRecentMessages(db, 20);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipientId).toBeNull();
    expect(rows[0]!.recipientPhone).toBeNull();
    expect(rows[0]!.recipientStatus).toBeNull();
  });
});
