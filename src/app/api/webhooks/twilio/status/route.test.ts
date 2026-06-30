/**
 * Tests for POST /api/webhooks/twilio/status (US-012).
 *
 * Two layers:
 *
 *   1. The pure helper `processTwilioStatus()` is exercised against
 *      a fresh `createTestDb()` — no `Request` / `next/headers`
 *      plumbing needed. These cover all the DB-shape behavior the
 *      story cares about: lookup, update, idempotency, audit log.
 *
 *   2. The route handler is exercised by building a real
 *      `new Request(...)` and asserting on the HTTP status. These
 *      cover form-body parsing, the 400 path, and the 200-on-200
 *      uniform-success contract that Twilio needs.
 *
 * Auth: the route handler deliberately has no `requireUser()` gate
 * (Twilio doesn't have a user-id cookie) so we don't need to seed
 * the auth override.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";
import {
  buildEventId,
  mapMessageStatusToEnum,
  processTwilioStatus,
  type ProcessTwilioStatusInput,
} from "@/lib/webhooks/twilio-status";

// ============================================================================
// Route handler plumbing
// ============================================================================

interface RouteModule {
  POST: (request: Request) => Promise<Response>;
}

async function callStatusRoute(request: Request): Promise<Response> {
  const mod = (await import("@/app/api/webhooks/twilio/status/route")) as RouteModule;
  return mod.POST(request);
}

/** Build a form-urlencoded Request — matches what Twilio actually sends. */
function twilioPost(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request("http://localhost/api/webhooks/twilio/status", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

// ============================================================================
// Pure helper tests
// ============================================================================

describe("mapMessageStatusToEnum", () => {
  it("maps delivered", () => {
    expect(mapMessageStatusToEnum("delivered")).toBe("delivered");
  });

  it("maps sent / sending", () => {
    expect(mapMessageStatusToEnum("sent")).toBe("sent");
    expect(mapMessageStatusToEnum("sending")).toBe("sent");
  });

  it("maps failed / undelivered / canceled", () => {
    expect(mapMessageStatusToEnum("failed")).toBe("failed");
    expect(mapMessageStatusToEnum("undelivered")).toBe("failed");
    expect(mapMessageStatusToEnum("canceled")).toBe("failed");
  });

  it("maps received / read", () => {
    expect(mapMessageStatusToEnum("received")).toBe("received");
    expect(mapMessageStatusToEnum("read")).toBe("received");
  });

  it("falls back to pending for unknown values", () => {
    expect(mapMessageStatusToEnum("queued")).toBe("pending");
    expect(mapMessageStatusToEnum("accepted")).toBe("pending");
    expect(mapMessageStatusToEnum("scheduled")).toBe("pending");
    expect(mapMessageStatusToEnum("garbage")).toBe("pending");
    expect(mapMessageStatusToEnum("")).toBe("pending");
  });
});

describe("buildEventId", () => {
  it("joins sid and status with a colon", () => {
    expect(buildEventId("SMabc", "delivered")).toBe("SMabc:delivered");
    expect(buildEventId("SMabc", "sent")).toBe("SMabc:sent");
  });
});

// ============================================================================
// processTwilioStatus — full coverage of the ACs
// ============================================================================

interface Seeded {
  db: TestDb;
  fixedNow: Date;
  userId: number;
  messageId: number;
  recipientId: number;
}

/**
 * Seed a user + a `sent` message with a known `twilio_message_sid`
 * on the parent row. Returns handles for the test to drive.
 */
async function seedSingleSend(): Promise<{
  db: TestDb;
  fixedNow: Date;
  userId: number;
  messageId: number;
}> {
  const db = createTestDb();
  const user = await db.insert("users", {
    id: 1,
    email: "alice@example.com",
    password_hash: "x",
    name: "Alice",
  });
  const message = await db.insert("messages", {
    user_id: user.id as number,
    body: "Hello",
    from_number: "+15550000000",
    status: "sent",
    twilio_message_sid: "SMseed_single_1",
    sent_at: new Date("2026-01-01T00:00:00Z"),
    cost_credits: 1,
  });
  return { db, fixedNow: new Date("2026-06-15T12:00:00Z"), userId: user.id as number, messageId: message.id as number };
}

/**
 * Seed a user + a `sent` message with NO `twilio_message_sid` on
 * the parent (the bulk-send shape) and ONE recipient that does have
 * a `twilio_message_sid`.
 */
async function seedBulkSend(): Promise<{
  db: TestDb;
  fixedNow: Date;
  userId: number;
  messageId: number;
  recipientId: number;
}> {
  const db = createTestDb();
  const user = await db.insert("users", {
    id: 1,
    email: "alice@example.com",
    password_hash: "x",
    name: "Alice",
  });
  const message = await db.insert("messages", {
    user_id: user.id as number,
    body: "Bulk hello",
    from_number: "+15550000000",
    status: "sent",
    // No twilio_message_sid on the parent — bulk doesn't set it.
    sent_at: new Date("2026-01-01T00:00:00Z"),
    cost_credits: 3,
  });
  const recipient = await db.insert("message_recipients", {
    message_id: message.id as number,
    phone: "+15551111111",
    status: "sent",
    twilio_message_sid: "SMseed_bulk_recip_1",
  });
  return {
    db,
    fixedNow: new Date("2026-06-15T12:00:00Z"),
    userId: user.id as number,
    messageId: message.id as number,
    recipientId: recipient.id as number,
  };
}

function asInput(
  partial: Pick<ProcessTwilioStatusInput, "messageSid" | "messageStatus"> & {
    errorCode?: string;
    db: TestDb;
    fixedNow: Date;
  },
): ProcessTwilioStatusInput {
  return {
    messageSid: partial.messageSid,
    messageStatus: partial.messageStatus,
    errorCode: partial.errorCode,
    db: partial.db,
    now: partial.fixedNow,
  };
}

describe("processTwilioStatus — message lookup path (single-send shape)", () => {
  it("updates a known message to delivered and stamps delivered_at", async () => {
    const seeded = await seedSingleSend();
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "delivered",
      }),
    );

    expect(outcome.result).toBe("updated_message");
    if (outcome.result !== "updated_message") throw new Error("unreachable");
    expect(outcome.messageId).toBe(seeded.messageId);
    expect(outcome.mappedStatus).toBe("delivered");
    expect(outcome.eventId).toBe("SMseed_single_1:delivered");

    const rows = await seeded.db.select("messages", { id: seeded.messageId });
    expect(rows[0]!.status).toBe("delivered");
    expect((rows[0]!.delivered_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );
  });

  it("updates a known message to sent and stamps sent_at", async () => {
    const seeded = await seedSingleSend();
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "sent",
      }),
    );
    expect(outcome.result).toBe("updated_message");

    const rows = await seeded.db.select("messages", { id: seeded.messageId });
    expect(rows[0]!.status).toBe("sent");
    expect((rows[0]!.sent_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );
    // delivered_at is NOT set when the event is just `sent`.
    expect(rows[0]!.delivered_at ?? null).toBeNull();
  });

  it("records the error_code when MessageStatus=failed", async () => {
    const seeded = await seedSingleSend();
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "failed",
        errorCode: "30007",
      }),
    );
    expect(outcome.result).toBe("updated_message");

    const rows = await seeded.db.select("messages", { id: seeded.messageId });
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error_code).toBe("30007");
  });
});

describe("processTwilioStatus — recipient lookup path (bulk-send shape)", () => {
  it("updates the matching recipient and its parent message", async () => {
    const seeded = await seedBulkSend();
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_bulk_recip_1",
        messageStatus: "delivered",
      }),
    );

    expect(outcome.result).toBe("updated_recipient");
    if (outcome.result !== "updated_recipient") throw new Error("unreachable");
    expect(outcome.messageId).toBe(seeded.messageId);
    expect(outcome.recipientId).toBe(seeded.recipientId);
    expect(outcome.mappedStatus).toBe("delivered");

    const recipients = await seeded.db.select("message_recipients", {
      id: seeded.recipientId,
    });
    expect(recipients[0]!.status).toBe("delivered");
    expect((recipients[0]!.delivered_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );

    const messages = await seeded.db.select("messages", { id: seeded.messageId });
    expect(messages[0]!.status).toBe("delivered");
    expect((messages[0]!.delivered_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );
  });

  it("stamps sent_at on the parent only when not already set", async () => {
    const seeded = await seedBulkSend();
    // Parent already has a sent_at — the recipient event should NOT
    // overwrite it.
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_bulk_recip_1",
        messageStatus: "sent",
      }),
    );
    expect(outcome.result).toBe("updated_recipient");

    const messages = await seeded.db.select("messages", { id: seeded.messageId });
    // The parent's pre-existing sent_at is preserved.
    expect((messages[0]!.sent_at as Date).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

describe("processTwilioStatus — idempotency + audit log + unknown sid", () => {
  it("is a no-op on the second call with the same (sid, status)", async () => {
    const seeded = await seedSingleSend();
    const first = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "delivered",
      }),
    );
    expect(first.result).toBe("updated_message");

    // Capture state after the first call.
    const afterFirst = await seeded.db.select("messages", { id: seeded.messageId });
    const firstDeliveredAt = afterFirst[0]!.delivered_at as Date;

    // Sleep the test clock forward — if the second call erroneously
    // re-stamps delivered_at, we'll see the change.
    const secondNow = new Date("2026-12-31T23:59:59Z");
    const second = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: secondNow,
        messageSid: "SMseed_single_1",
        messageStatus: "delivered",
      }),
    );

    expect(second.result).toBe("duplicate");
    expect(second.eventId).toBe("SMseed_single_1:delivered");

    const afterSecond = await seeded.db.select("messages", { id: seeded.messageId });
    // The second call must NOT have re-stamped delivered_at.
    expect((afterSecond[0]!.delivered_at as Date).toISOString()).toBe(
      firstDeliveredAt.toISOString(),
    );
  });

  it("treats (sid, sent) and (sid, delivered) as distinct events", async () => {
    const seeded = await seedSingleSend();

    const sent = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "sent",
      }),
    );
    expect(sent.result).toBe("updated_message");

    const delivered = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "delivered",
      }),
    );
    expect(delivered.result).toBe("updated_message");

    const webhookEvents = await seeded.db.select("webhook_events", {
      source: "twilio",
    });
    expect(webhookEvents).toHaveLength(2);
    const eventIds = webhookEvents.map((r) => r.event_id).sort();
    expect(eventIds).toEqual([
      "SMseed_single_1:delivered",
      "SMseed_single_1:sent",
    ]);
  });

  it("inserts a webhook_events row per unique event", async () => {
    const seeded = await seedSingleSend();
    await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMseed_single_1",
        messageStatus: "delivered",
        errorCode: "30007",
      }),
    );

    const events = await seeded.db.select("webhook_events", { source: "twilio" });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.source).toBe("twilio");
    expect(event.event_id).toBe("SMseed_single_1:delivered");
    expect(event.payload).toMatchObject({
      message_sid: "SMseed_single_1",
      message_status: "delivered",
      error_code: "30007",
    });
    // The shim stamps `created_at` on insert; the application layer
    // is responsible for `processed_at` (a later story will mark
    // events as processed in a background sweep). We don't assert
    // on it here — just confirm the row is queryable.
    expect(event.created_at).toBeDefined();
  });

  it("returns 'unknown' for an unknown MessageSid, still records the event, no crash", async () => {
    const seeded = await seedSingleSend();
    const outcome = await processTwilioStatus(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        messageSid: "SMnever_seen",
        messageStatus: "delivered",
      }),
    );

    expect(outcome.result).toBe("unknown");
    expect(outcome.eventId).toBe("SMnever_seen:delivered");

    // Event was still logged.
    const events = await seeded.db.select("webhook_events", { source: "twilio" });
    expect(events).toHaveLength(1);
    expect(events[0]!.event_id).toBe("SMnever_seen:delivered");

    // The pre-existing message was NOT touched.
    const rows = await seeded.db.select("messages", { id: seeded.messageId });
    expect(rows[0]!.status).toBe("sent");
  });
});

// ============================================================================
// Route handler tests — cover the HTTP surface + form-body parsing
// ============================================================================

describe("POST /api/webhooks/twilio/status", () => {
  beforeEach(() => {
    __resetTestDbForTests();
  });

  afterEach(() => {
    __resetTestDbForTests();
  });

  it("parses a form body and updates the matching message", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    await db.insert("messages", {
      id: 1,
      user_id: 1,
      body: "Hello",
      from_number: "+15550000000",
      status: "sent",
      twilio_message_sid: "SM123",
      cost_credits: 1,
    });

    const res = await callStatusRoute(
      twilioPost({
        MessageSid: "SM123",
        MessageStatus: "delivered",
        SmsSid: "SM123", // Twilio also sends this; we should ignore it.
        SmsStatus: "delivered", // ditto
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result).toBe("updated_message");

    const messages = await db.select("messages", { id: 1 });
    expect(messages[0]!.status).toBe("delivered");
    expect(messages[0]!.delivered_at).toBeInstanceOf(Date);
  });

  it("returns 200 with result='duplicate' on a replay of the same event", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    await db.insert("messages", {
      id: 1,
      user_id: 1,
      body: "Hello",
      from_number: "+15550000000",
      status: "sent",
      twilio_message_sid: "SMdup",
      cost_credits: 1,
    });

    // First call — updates.
    const first = await callStatusRoute(
      twilioPost({ MessageSid: "SMdup", MessageStatus: "delivered" }),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.result).toBe("updated_message");

    // Second call — duplicate.
    const second = await callStatusRoute(
      twilioPost({ MessageSid: "SMdup", MessageStatus: "delivered" }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.result).toBe("duplicate");
    expect(secondBody.eventId).toBe("SMdup:delivered");

    // Only one webhook_events row exists.
    const events = await db.select("webhook_events", { source: "twilio" });
    expect(events).toHaveLength(1);
  });

  it("returns 400 when MessageSid is missing", async () => {
    const res = await callStatusRoute(
      twilioPost({ MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/MessageSid/i);
  });

  it("returns 400 when MessageSid is the empty string", async () => {
    const res = await callStatusRoute(
      twilioPost({ MessageSid: "", MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 with result='unknown' for an unknown MessageSid", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });

    const res = await callStatusRoute(
      twilioPost({ MessageSid: "SMnever", MessageStatus: "delivered" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("unknown");

    // The unknown-sid event was still recorded for the audit log.
    const events = await db.select("webhook_events", { source: "twilio" });
    expect(events).toHaveLength(1);
  });

  it("accepts a multipart form-data body (in case Twilio switches encodings)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    await db.insert("messages", {
      id: 1,
      user_id: 1,
      body: "Hello",
      from_number: "+15550000000",
      status: "sent",
      twilio_message_sid: "SMmultipart",
      cost_credits: 1,
    });

    const form = new FormData();
    form.set("MessageSid", "SMmultipart");
    form.set("MessageStatus", "delivered");
    const req = new Request("http://localhost/api/webhooks/twilio/status", {
      method: "POST",
      body: form,
    });

    const res = await callStatusRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("updated_message");
  });
});
