/**
 * Unit tests for `processTwilioStatus` — the route-handler-decoupled
 * core of the Twilio status webhook (US-012). The route handler
 * tests in `src/app/api/webhooks/twilio/status/route.test.ts` cover
 * the HTTP surface; this file covers the pure logic with no
 * `Request` / `next/headers` plumbing.
 *
 * The pure helper is also re-imported from the route test file,
 * so this file focuses on edge cases the route-level test doesn't
 * need to cover (e.g. multi-recipient bulk, error code preservation,
 * recipient vs message priority).
 */

import { describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/db";
import { processTwilioStatus } from "@/lib/webhooks/twilio-status";

async function seedUserAndMessage(
  db: TestDb,
  opts: { sid?: string; status?: string } = {},
): Promise<{ userId: number; messageId: number }> {
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
    status: opts.status ?? "sent",
    twilio_message_sid: opts.sid ?? null,
    cost_credits: 1,
  });
  return { userId: user.id as number, messageId: message.id as number };
}

const FIXED_NOW = new Date("2026-06-15T12:00:00Z");

describe("processTwilioStatus — bulk blast (one message, N recipients)", () => {
  it("updates only the matching recipient; siblings untouched", async () => {
    const db = createTestDb();
    const { messageId } = await seedUserAndMessage(db, {
      // Bulk blasts leave the parent twilio_message_sid null.
      sid: undefined as unknown as string,
      status: "sent",
    });
    const r1 = await db.insert("message_recipients", {
      message_id: messageId,
      phone: "+15551111111",
      status: "sent",
      twilio_message_sid: "SM_r1",
    });
    const r2 = await db.insert("message_recipients", {
      message_id: messageId,
      phone: "+15552222222",
      status: "sent",
      twilio_message_sid: "SM_r2",
    });

    const outcome = await processTwilioStatus({
      messageSid: "SM_r2",
      messageStatus: "delivered",
      db,
      now: FIXED_NOW,
    });

    expect(outcome.result).toBe("updated_recipient");
    if (outcome.result !== "updated_recipient") throw new Error("unreachable");
    expect(outcome.recipientId).toBe(r2.id);

    const r1After = await db.select("message_recipients", { id: r1.id as number });
    const r2After = await db.select("message_recipients", { id: r2.id as number });
    expect(r1After[0]!.status).toBe("sent");
    expect(r1After[0]!.delivered_at ?? null).toBeNull();
    expect(r2After[0]!.status).toBe("delivered");
    expect((r2After[0]!.delivered_at as Date).toISOString()).toBe(
      FIXED_NOW.toISOString(),
    );
  });

  it("preserves the parent's pre-existing error_code when recipient event has one", async () => {
    const db = createTestDb();
    const { messageId } = await seedUserAndMessage(db, {
      sid: undefined as unknown as string,
    });
    // Parent already carries an error code from an earlier event.
    await db.update(
      "messages",
      { id: messageId },
      { error_code: "30005" },
    );
    await db.insert("message_recipients", {
      message_id: messageId,
      phone: "+15551111111",
      status: "sent",
      twilio_message_sid: "SM_first",
    });

    // A new recipient's event comes in with a different error code.
    // The parent's pre-existing code should NOT be overwritten.
    await processTwilioStatus({
      messageSid: "SM_first",
      messageStatus: "delivered",
      errorCode: "30007",
      db,
      now: FIXED_NOW,
    });

    const messages = await db.select("messages", { id: messageId });
    expect(messages[0]!.error_code).toBe("30005");
  });
});

describe("processTwilioStatus — error code on the single-send path", () => {
  it("records error_code on the message row", async () => {
    const db = createTestDb();
    const { messageId } = await seedUserAndMessage(db, { sid: "SM_one" });

    await processTwilioStatus({
      messageSid: "SM_one",
      messageStatus: "undelivered",
      errorCode: "30006",
      db,
      now: FIXED_NOW,
    });

    const messages = await db.select("messages", { id: messageId });
    expect(messages[0]!.status).toBe("failed");
    expect(messages[0]!.error_code).toBe("30006");
  });

  it("does not set error_code when the form omits it", async () => {
    const db = createTestDb();
    const { messageId } = await seedUserAndMessage(db, { sid: "SM_clean" });

    await processTwilioStatus({
      messageSid: "SM_clean",
      messageStatus: "delivered",
      db,
      now: FIXED_NOW,
    });

    const messages = await db.select("messages", { id: messageId });
    expect(messages[0]!.error_code ?? null).toBeNull();
  });
});

describe("processTwilioStatus — message lookup wins over recipient", () => {
  it("picks the parent message when both have the same sid", async () => {
    // This shouldn't happen in practice (single-send has one sid
    // on the parent, bulk has different sids on each recipient),
    // but the documented lookup order says "message first" — let's
    // pin the behavior so a regression is loud.
    const db = createTestDb();
    await seedUserAndMessage(db, { sid: "SM_shared" });
    const recipient = await db.insert("message_recipients", {
      phone: "+15551111111",
      status: "sent",
      twilio_message_sid: "SM_shared",
    });

    const outcome = await processTwilioStatus({
      messageSid: "SM_shared",
      messageStatus: "delivered",
      db,
      now: FIXED_NOW,
    });

    expect(outcome.result).toBe("updated_message");
    // The recipient is NOT touched.
    const r = await db.select("message_recipients", { id: recipient.id as number });
    expect(r[0]!.status).toBe("sent");
  });
});
