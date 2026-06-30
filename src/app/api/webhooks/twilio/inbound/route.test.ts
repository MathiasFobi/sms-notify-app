/**
 * Tests for POST /api/webhooks/twilio/inbound (US-013).
 *
 * Two layers, mirroring the US-012 split:
 *
 *   1. The pure helper `processTwilioInbound()` is exercised against
 *      a fresh `createTestDb()` — no `Request` / `next/headers`
 *      plumbing needed. These cover all the DB-shape behavior the
 *      story cares about: user resolution, idempotency, STOP-keyword
 *      handling, missing-contact tolerance.
 *
 *   2. The route handler is exercised by building a real
 *      `new Request(...)` and asserting on the HTTP status. These
 *      cover form-body parsing, the 400 paths, and the uniform-200
 *      contract Twilio needs.
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
  isOptOutKeyword,
  matchOptOutKeyword,
  OPT_OUT_KEYWORDS,
  processTwilioInbound,
  type ProcessTwilioInboundInput,
} from "@/lib/webhooks/twilio-inbound";

// ============================================================================
// Route handler plumbing
// ============================================================================

interface RouteModule {
  POST: (request: Request) => Promise<Response>;
}

async function callInboundRoute(request: Request): Promise<Response> {
  const mod = (await import(
    "@/app/api/webhooks/twilio/inbound/route"
  )) as RouteModule;
  return mod.POST(request);
}

/** Build a form-urlencoded Request — matches what Twilio actually sends. */
function twilioPost(fields: Record<string, string>): Request {
  const body = new URLSearchParams(fields).toString();
  return new Request("http://localhost/api/webhooks/twilio/inbound", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

// ============================================================================
// Keyword matching helpers
// ============================================================================

describe("isOptOutKeyword", () => {
  it.each(OPT_OUT_KEYWORDS)("recognizes %s", (kw) => {
    expect(isOptOutKeyword(kw)).toBe(true);
    expect(isOptOutKeyword(kw.toLowerCase())).toBe(true);
    expect(isOptOutKeyword(`  ${kw.toLowerCase()}  `)).toBe(true);
  });

  it("rejects other words", () => {
    expect(isOptOutKeyword("HELP")).toBe(false);
    expect(isOptOutKeyword("YES")).toBe(false);
    expect(isOptOutKeyword("START")).toBe(false);
    expect(isOptOutKeyword("")).toBe(false);
    expect(isOptOutKeyword("STOP NOW")).toBe(false);
    expect(isOptOutKeyword("STOPIT")).toBe(false);
  });
});

describe("matchOptOutKeyword", () => {
  it("returns the canonical (uppercased) keyword", () => {
    expect(matchOptOutKeyword("stop")).toBe("STOP");
    expect(matchOptOutKeyword("StopAll")).toBe("STOPALL");
    expect(matchOptOutKeyword("  unsubscribe  ")).toBe("UNSUBSCRIBE");
  });

  it("returns null for non-matching bodies", () => {
    expect(matchOptOutKeyword("HELP")).toBeNull();
    expect(matchOptOutKeyword("")).toBeNull();
    expect(matchOptOutKeyword("STOP IT")).toBeNull();
  });
});

// ============================================================================
// Test fixtures
// ============================================================================

interface Seeded {
  db: TestDb;
  fixedNow: Date;
  userId: number;
}

/**
 * Seed a user with a `twilio_from_number` set — the common case for
 * the inbound webhook. Returns handles for the test to drive.
 */
async function seedUserWithFromNumber(): Promise<{
  db: TestDb;
  fixedNow: Date;
  userId: number;
}> {
  const db = createTestDb();
  const user = await db.insert("users", {
    id: 1,
    email: "alice@example.com",
    password_hash: "x",
    name: "Alice",
    twilio_from_number: "+15550000000",
  });
  return {
    db,
    fixedNow: new Date("2026-06-15T12:00:00Z"),
    userId: user.id as number,
  };
}

function asInput(
  partial: Pick<
    ProcessTwilioInboundInput,
    "from" | "to" | "body" | "messageSid"
  > & {
    db: TestDb;
    fixedNow: Date;
  },
): ProcessTwilioInboundInput {
  return {
    from: partial.from,
    to: partial.to,
    body: partial.body,
    messageSid: partial.messageSid,
    db: partial.db,
    now: partial.fixedNow,
  };
}

// ============================================================================
// processTwilioInbound — basic inbound store (AC #2, #5)
// ============================================================================

describe("processTwilioInbound — basic inbound store", () => {
  it("inserts a new inbound_messages row scoped to the resolved user", async () => {
    const seeded = await seedUserWithFromNumber();
    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body: "Hey, got your message",
        messageSid: "SM_inbound_1",
      }),
    );

    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.userId).toBe(seeded.userId);
    expect(outcome.messageSid).toBe("SM_inbound_1");
    expect(outcome.inboundMessageId).toBeGreaterThan(0);
    // Non-opt-out body → no opt-out bookkeeping.
    expect(outcome.optOutApplied).toBe(false);
    expect(outcome.optOutKeyword).toBeUndefined();

    const rows = await seeded.db.select("inbound_messages", {
      twilio_message_sid: "SM_inbound_1",
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.user_id).toBe(seeded.userId);
    expect(row.from_phone).toBe("+15551111111");
    expect(row.to_number).toBe("+15550000000");
    expect(row.body).toBe("Hey, got your message");
    expect((row.received_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );
  });

  it("stores an inbound row even when no contact matches the From number", async () => {
    const seeded = await seedUserWithFromNumber();
    // No contact seeded — From is from a stranger.
    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15559999999",
        to: "+15550000000",
        body: "wrong number, who is this?",
        messageSid: "SM_stranger_1",
      }),
    );

    expect(outcome.result).toBe("inserted");
    const rows = await seeded.db.select("inbound_messages", {
      twilio_message_sid: "SM_stranger_1",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.from_phone).toBe("+15559999999");
    // Body is not an opt-out keyword → optOutApplied stays false.
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.optOutApplied).toBe(false);
  });

  it("supports From phone numbers in non-canonical forms (normalizes for lookup)", async () => {
    const seeded = await seedUserWithFromNumber();
    // Seed a contact with a normalized phone; the inbound From is
    // presented in a free-form shape. We verify the helper still
    // matches.
    await seeded.db.insert("contacts", {
      user_id: seeded.userId,
      phone: "+15551234567",
      first_name: "Bob",
      opted_out: false,
    });

    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "(555) 123-4567", // un-normalized
        to: "+15550000000",
        body: "STOP",
        messageSid: "SM_norm_match",
      }),
    );
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.optOutApplied).toBe(true);

    // The contact with the normalized phone was opted out — proving
    // the helper did normalize From before matching.
    const contacts = await seeded.db.select("contacts", {
      user_id: seeded.userId,
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.phone).toBe("+15551234567");
    expect(contacts[0]!.opted_out).toBe(true);
  });
});

// ============================================================================
// processTwilioInbound — STOP keyword suppression (AC #4)
// ============================================================================

describe("processTwilioInbound — STOP keyword suppression", () => {
  it.each([
    "STOP",
    "stop",
    "Stop",
    "  STOP  ",
    "STOPALL",
    "stopall",
    "UNSUBSCRIBE",
    "unsubscribe",
    "CANCEL",
    "cancel",
    "END",
    "end",
  ])("flips opted_out=true on a matching contact for keyword %s", async (body) => {
    const seeded = await seedUserWithFromNumber();
    await seeded.db.insert("contacts", {
      user_id: seeded.userId,
      phone: "+15551111111",
      first_name: "Bob",
      opted_out: false,
    });

    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body,
        messageSid: `SM_${body}_${seeded.userId}`,
      }),
    );
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.optOutApplied).toBe(true);
    expect(outcome.optOutKeyword).toBe(body.trim().toUpperCase().replace(/\s+/g, ""));

    const contacts = await seeded.db.select("contacts", {
      user_id: seeded.userId,
    });
    expect(contacts[0]!.opted_out).toBe(true);
  });

  it("STOP with no matching contact still stores the inbound and returns 200 (no crash)", async () => {
    const seeded = await seedUserWithFromNumber();
    // No contact seeded.
    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15558888888",
        to: "+15550000000",
        body: "STOP",
        messageSid: "SM_stop_no_contact",
      }),
    );

    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    // The inbound row is still logged.
    const rows = await seeded.db.select("inbound_messages", {
      twilio_message_sid: "SM_stop_no_contact",
    });
    expect(rows).toHaveLength(1);
    // optOutApplied is false because we have no contact to update.
    expect(outcome.optOutApplied).toBe(false);
    // The keyword matched, but no contact to flip.
    expect(outcome.optOutKeyword).toBe("STOP");
  });

  it("is a no-op when a contact is already opted out (still returns inserted)", async () => {
    const seeded = await seedUserWithFromNumber();
    await seeded.db.insert("contacts", {
      user_id: seeded.userId,
      phone: "+15551111111",
      first_name: "Bob",
      opted_out: true,
    });

    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body: "STOP",
        messageSid: "SM_already_out",
      }),
    );
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    // The contact was already opted out — we don't double-write,
    // and we don't claim we did.
    expect(outcome.optOutApplied).toBe(false);

    const contacts = await seeded.db.select("contacts", {
      user_id: seeded.userId,
    });
    expect(contacts[0]!.opted_out).toBe(true);
  });

  it("non-opt-out keywords do NOT flip opted_out", async () => {
    const seeded = await seedUserWithFromNumber();
    await seeded.db.insert("contacts", {
      user_id: seeded.userId,
      phone: "+15551111111",
      first_name: "Bob",
      opted_out: false,
    });

    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body: "HELP",
        messageSid: "SM_help",
      }),
    );
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.optOutApplied).toBe(false);
    expect(outcome.optOutKeyword).toBeUndefined();

    const contacts = await seeded.db.select("contacts", {
      user_id: seeded.userId,
    });
    expect(contacts[0]!.opted_out).toBe(false);
  });

  it("STOP only affects contacts owned by the resolved user (no cross-user opt-out)", async () => {
    const db = createTestDb();
    const userA = await db.insert("users", {
      id: 1,
      email: "a@example.com",
      password_hash: "x",
      name: "A",
      twilio_from_number: "+15550000000",
    });
    const userB = await db.insert("users", {
      id: 2,
      email: "b@example.com",
      password_hash: "x",
      name: "B",
    });
    // Same phone number exists for BOTH users (the contacts table
    // uniqueness is per-user).
    await db.insert("contacts", {
      user_id: userA.id as number,
      phone: "+15551111111",
      opted_out: false,
    });
    await db.insert("contacts", {
      user_id: userB.id as number,
      phone: "+15551111111",
      opted_out: false,
    });

    const outcome = await processTwilioInbound({
      from: "+15551111111",
      to: "+15550000000",
      body: "STOP",
      messageSid: "SM_cross_user",
      db,
      now: new Date("2026-06-15T12:00:00Z"),
    });
    expect(outcome.result).toBe("inserted");

    const aContacts = await db.select("contacts", { user_id: userA.id as number });
    const bContacts = await db.select("contacts", { user_id: userB.id as number });
    expect(aContacts[0]!.opted_out).toBe(true);
    expect(bContacts[0]!.opted_out).toBe(false);
  });

  it("tolerates an unparseable From phone (no contact match, no crash)", async () => {
    const seeded = await seedUserWithFromNumber();
    // Junk From that normalizePhone will reject.
    const outcome = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "abc",
        to: "+15550000000",
        body: "STOP",
        messageSid: "SM_junk_from",
      }),
    );
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.optOutApplied).toBe(false);
    // The inbound row still landed.
    const rows = await seeded.db.select("inbound_messages", {
      twilio_message_sid: "SM_junk_from",
    });
    expect(rows).toHaveLength(1);
  });
});

// ============================================================================
// processTwilioInbound — idempotency on replay (AC #3)
// ============================================================================

describe("processTwilioInbound — replay idempotency", () => {
  it("replay of the same MessageSid does not create a duplicate row", async () => {
    const seeded = await seedUserWithFromNumber();
    const first = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body: "first",
        messageSid: "SM_replay",
      }),
    );
    expect(first.result).toBe("inserted");
    if (first.result !== "inserted") throw new Error("unreachable");

    // Second delivery of the SAME sid — even with a different body.
    const secondNow = new Date("2026-12-31T23:59:59Z");
    const second = await processTwilioInbound({
      from: "+15551111111",
      to: "+15550000000",
      body: "REPLAY", // body changed — but we still dedupe on MessageSid
      messageSid: "SM_replay",
      db: seeded.db,
      now: secondNow,
    });

    expect(second.result).toBe("duplicate");
    expect(second.messageSid).toBe("SM_replay");

    // Only one inbound row exists, with the original body + received_at.
    const rows = await seeded.db.select("inbound_messages", {
      twilio_message_sid: "SM_replay",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("first");
    expect((rows[0]!.received_at as Date).toISOString()).toBe(
      seeded.fixedNow.toISOString(),
    );
  });

  it("a STOP replay does NOT re-flip opted_out (no second write)", async () => {
    const seeded = await seedUserWithFromNumber();
    await seeded.db.insert("contacts", {
      user_id: seeded.userId,
      phone: "+15551111111",
      opted_out: false,
    });

    const first = await processTwilioInbound(
      asInput({
        db: seeded.db,
        fixedNow: seeded.fixedNow,
        from: "+15551111111",
        to: "+15550000000",
        body: "STOP",
        messageSid: "SM_stop_replay",
      }),
    );
    expect(first.result).toBe("inserted");

    // Now manually flip opted_out back to false — proving the replay
    // does NOT re-touch the contact (because the inbound row already
    // exists and we short-circuit).
    await seeded.db.update(
      "contacts",
      { user_id: seeded.userId, phone: "+15551111111" },
      { opted_out: false },
    );

    const second = await processTwilioInbound({
      from: "+15551111111",
      to: "+15550000000",
      body: "STOP",
      messageSid: "SM_stop_replay",
      db: seeded.db,
      now: new Date("2026-12-31T23:59:59Z"),
    });
    expect(second.result).toBe("duplicate");

    // Contact is STILL opted_out=false — the replay didn't run the
    // STOP-handling branch.
    const contacts = await seeded.db.select("contacts", {
      user_id: seeded.userId,
    });
    expect(contacts[0]!.opted_out).toBe(false);
  });
});

// ============================================================================
// processTwilioInbound — user resolution edge cases
// ============================================================================

describe("processTwilioInbound — user resolution", () => {
  it("resolves via users.twilio_from_number", async () => {
    const db = createTestDb();
    const user = await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });
    await db.insert("contacts", {
      user_id: user.id as number,
      phone: "+15551111111",
      opted_out: false,
    });

    const outcome = await processTwilioInbound({
      from: "+15551111111",
      to: "+15550000000",
      body: "STOP",
      messageSid: "SM_resolve_from",
      db,
      now: new Date(),
    });
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.userId).toBe(user.id as number);
    expect(outcome.optOutApplied).toBe(true);
  });

  it("resolves via approved sender_ids when twilio_from_number doesn't match", async () => {
    const db = createTestDb();
    const user = await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      // No twilio_from_number — the user is replying via a sender_id
      // they registered.
    });
    await db.insert("sender_ids", {
      user_id: user.id as number,
      value: "MYBRAND",
      status: "approved",
    });
    await db.insert("contacts", {
      user_id: user.id as number,
      phone: "+15551111111",
      opted_out: false,
    });

    const outcome = await processTwilioInbound({
      from: "+15551111111",
      to: "MYBRAND",
      body: "STOP",
      messageSid: "SM_resolve_sender",
      db,
      now: new Date(),
    });
    expect(outcome.result).toBe("inserted");
    if (outcome.result !== "inserted") throw new Error("unreachable");
    expect(outcome.userId).toBe(user.id as number);
    expect(outcome.optOutApplied).toBe(true);
  });

  it("does NOT resolve via pending or rejected sender_ids", async () => {
    const db = createTestDb();
    const user = await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    await db.insert("sender_ids", {
      user_id: user.id as number,
      value: "MYBRAND",
      status: "pending",
    });

    const outcome = await processTwilioInbound({
      from: "+15551111111",
      to: "MYBRAND",
      body: "hi",
      messageSid: "SM_pending_sender",
      db,
      now: new Date(),
    });
    if (outcome.result !== "unknown_to") throw new Error("expected unknown_to");
    expect(outcome.to).toBe("MYBRAND");

    // Now swap to rejected.
    await db.update(
      "sender_ids",
      { user_id: user.id as number, value: "MYBRAND" },
      { status: "rejected" },
    );
    const outcome2 = await processTwilioInbound({
      from: "+15551111111",
      to: "MYBRAND",
      body: "hi",
      messageSid: "SM_rejected_sender",
      db,
      now: new Date(),
    });
    expect(outcome2.result).toBe("unknown_to");
  });

  it("returns unknown_to when To matches no user, no inbound row is inserted", async () => {
    const db = createTestDb();
    // No users at all.
    const outcome = await processTwilioInbound({
      from: "+15551111111",
      to: "+15550000000",
      body: "hello",
      messageSid: "SM_no_user",
      db,
      now: new Date(),
    });
    if (outcome.result !== "unknown_to") throw new Error("expected unknown_to");
    expect(outcome.to).toBe("+15550000000");

    const rows = await db.select("inbound_messages", {});
    expect(rows).toHaveLength(0);
  });
});

// ============================================================================
// Route handler tests — cover the HTTP surface + form-body parsing (AC #1, #6)
// ============================================================================

describe("POST /api/webhooks/twilio/inbound", () => {
  beforeEach(() => {
    __resetTestDbForTests();
  });

  afterEach(() => {
    __resetTestDbForTests();
  });

  it("parses a form body and inserts an inbound row (AC #1, #2)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });

    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        Body: "hi there",
        MessageSid: "SM_route_1",
        SmsSid: "SM_route_1", // Twilio also sends this; we should ignore it.
        SmsMessageSid: "SM_route_1",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result).toBe("inserted");
    expect(body.userId).toBe(1);

    const rows = await db.select("inbound_messages", {
      twilio_message_sid: "SM_route_1",
    });
    expect(rows).toHaveLength(1);
  });

  it("returns 200 with result='duplicate' on a replay (AC #3)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });

    const first = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        Body: "first",
        MessageSid: "SM_replay_route",
      }),
    );
    expect(first.status).toBe(200);
    expect((await first.json()).result).toBe("inserted");

    const second = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        Body: "second (replay)",
        MessageSid: "SM_replay_route",
      }),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.result).toBe("duplicate");
    expect(secondBody.messageSid).toBe("SM_replay_route");

    // Only one inbound row.
    const rows = await db.select("inbound_messages", {
      twilio_message_sid: "SM_replay_route",
    });
    expect(rows).toHaveLength(1);
  });

  it("STOP via the route handler flips opted_out on the matching contact (AC #4)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551111111",
      opted_out: false,
    });

    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        Body: "STOP",
        MessageSid: "SM_stop_route",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("inserted");
    expect(body.optOutApplied).toBe(true);
    expect(body.optOutKeyword).toBe("STOP");

    const contacts = await db.select("contacts", { user_id: 1 });
    expect(contacts[0]!.opted_out).toBe(true);
  });

  it("STOP with no matching contact returns 200, still stores inbound (AC #5)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });

    const res = await callInboundRoute(
      twilioPost({
        From: "+15559999999", // no matching contact
        To: "+15550000000",
        Body: "STOP",
        MessageSid: "SM_stop_no_contact_route",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("inserted");
    expect(body.optOutApplied).toBe(false);
    expect(body.optOutKeyword).toBe("STOP");

    // The inbound row was still stored.
    const rows = await db.select("inbound_messages", {
      twilio_message_sid: "SM_stop_no_contact_route",
    });
    expect(rows).toHaveLength(1);
  });

  it("returns 200 with result='unknown_to' when To matches no user (no crash)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000", // no user with this number
        Body: "hello?",
        MessageSid: "SM_unknown_to",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("unknown_to");
    expect(body.to).toBe("+15550000000");
  });

  it("returns 400 when From is missing (AC #6)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        To: "+15550000000",
        Body: "hi",
        MessageSid: "SM",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/From/i);
  });

  it("returns 400 when To is missing (AC #6)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        Body: "hi",
        MessageSid: "SM",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/To/i);
  });

  it("returns 400 when Body is missing (AC #6)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        MessageSid: "SM",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Body/i);
  });

  it("returns 400 when MessageSid is missing (AC #6)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        From: "+15551111111",
        To: "+15550000000",
        Body: "hi",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/MessageSid/i);
  });

  it("returns 400 when From is an empty string (AC #6)", async () => {
    const res = await callInboundRoute(
      twilioPost({
        From: "",
        To: "+15550000000",
        Body: "hi",
        MessageSid: "SM",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a multipart form-data body (in case Twilio switches encodings)", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
      twilio_from_number: "+15550000000",
    });

    const form = new FormData();
    form.set("From", "+15551111111");
    form.set("To", "+15550000000");
    form.set("Body", "multipart hello");
    form.set("MessageSid", "SM_multipart");
    const req = new Request("http://localhost/api/webhooks/twilio/inbound", {
      method: "POST",
      body: form,
    });

    const res = await callInboundRoute(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toBe("inserted");
  });
});