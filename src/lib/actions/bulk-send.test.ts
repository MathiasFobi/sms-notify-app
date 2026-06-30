import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __sendBulkSmsInternal,
  sendBulkSmsAction,
  type SendBulkSmsInput,
} from "@/lib/actions/bulk-send";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import { MockSmsProvider } from "@/lib/sms";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Test seeding helpers.
 *
 * Each `describe` block seeds a fresh `createTestDb()` so the
 * internal-helper tests get full isolation. Tests that exercise the
 * public `sendBulkSmsAction` (which goes through `getTestDb()`) seed
 * via the singleton instead, matching the pattern from
 * sender-ids / contact-groups / contacts / send test files.
 */

async function seedUser(
  db: TestDb,
  id: number,
  email: string,
  opts: { twilioFromNumber?: string } = {},
): Promise<void> {
  await db.insert("users", {
    id,
    email,
    password_hash: "x",
    name: email,
    twilio_from_number: opts.twilioFromNumber ?? null,
  });
}

async function seedAccount(
  db: TestDb,
  userId: number,
  credits: number,
): Promise<void> {
  await db.insert("accounts", {
    user_id: userId,
    credits,
  });
}

async function seedContact(
  db: TestDb,
  userId: number,
  phone: string,
  opts: { optedOut?: boolean } = {},
): Promise<number> {
  const inserted = await db.insert("contacts", {
    user_id: userId,
    phone,
    opted_out: opts.optedOut ?? false,
  });
  return inserted.id as number;
}

interface CallRecord {
  to: string;
  body: string;
  from: string;
}

/**
 * A test-only SmsProvider spy that records every `send()` call and
 * returns either a stubbed `providerMessageId` or a configured
 * failure. Lets us assert on call shape without depending on the
 * singleton or `MockSmsProvider`'s internal store.
 */
function makeSpyProvider(opts: {
  providerMessageId?: string;
  failPhones?: Set<string>;
} = {}): {
  provider: import("@/lib/sms").SmsProvider;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  const failPhones = opts.failPhones ?? new Set<string>();
  const provider: import("@/lib/sms").SmsProvider = {
    async send(message) {
      calls.push({
        to: message.to,
        body: message.body,
        from: message.from ?? "",
      });
      if (failPhones.has(message.to)) {
        return {
          ok: false,
          priceUsd: 0,
          segments: 0,
          error: "test forced failure",
        };
      }
      return {
        ok: true,
        providerMessageId:
          opts.providerMessageId ?? `mock_test-${calls.length}`,
        priceUsd: 0.0079,
        segments: 1,
      };
    },
    async fetch() {
      return null;
    },
  };
  return { provider, calls };
}

// ===========================================================================
// __sendBulkSmsInternal — happy path
// ===========================================================================

describe("__sendBulkSmsInternal() — happy path", () => {
  let db: TestDb;
  let provider: import("@/lib/sms").SmsProvider;
  let calls: CallRecord[];

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
    const spy = makeSpyProvider();
    provider = spy.provider;
    calls = spy.calls;
  });

  it("inserts 1 message + 3 recipients for a 3-row CSV and decrements credits by 3", async () => {
    const csv = ["+15551234567", "+15551234568", "+15551234569"].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hello bulk",
      db,
      provider,
    });

    expect(result.messageId).toBeTypeOf("number");
    expect(result.recipientIds).toHaveLength(3);
    expect(result.queued).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.invalid).toBe(0);
    expect(result.optedOut).toBe(0);
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.providerMessageIds).toHaveLength(3);

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: result.messageId,
      user_id: 1,
      body: "hello bulk",
      from_number: "+15550000001",
      status: "sent",
      cost_credits: 3,
    });

    const recipients = await db.select("message_recipients", {
      message_id: result.messageId,
    });
    expect(recipients).toHaveLength(3);
    expect(recipients.map((r) => r.phone).sort()).toEqual(
      ["+15551234567", "+15551234568", "+15551234569"].sort(),
    );
    for (const r of recipients) {
      expect(r.status).toBe("sent");
      expect(r.twilio_message_sid).toMatch(/^mock_test-/);
    }

    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(7); // 10 - 3

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      user_id: 1,
      delta: -3,
      reason: "send",
    });
  });

  it("calls provider.send exactly once per recipient with the user-supplied body", async () => {
    const csv = ["+15551234567", "+15551234568", "+15551234569"].join("\n");
    await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "blast body",
      db,
      provider,
    });

    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.to).sort()).toEqual(
      ["+15551234567", "+15551234568", "+15551234569"].sort(),
    );
    for (const c of calls) {
      expect(c.body).toBe("blast body");
      expect(c.from).toBe("+15550000001");
    }
  });

  it("accepts a CSV with a 'phone' header row (auto-detects and skips it)", async () => {
    const csv = ["phone", "+15551234567", "+15551234568"].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);

    const recipients = await db.select("message_recipients", {
      message_id: result.messageId,
    });
    expect(recipients).toHaveLength(2);
    expect(recipients.map((r) => r.phone).sort()).toEqual(
      ["+15551234567", "+15551234568"].sort(),
    );
  });

  it("normalizes phones before persisting + provider call", async () => {
    const csv = ["(555) 123-4567", "5551234568"].join("\n");
    await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(calls.map((c) => c.to).sort()).toEqual(
      ["+15551234567", "+15551234568"].sort(),
    );
    const recipients = await db.select("message_recipients", {});
    expect(recipients.map((r) => r.phone).sort()).toEqual(
      ["+15551234567", "+15551234568"].sort(),
    );
  });

  it("uses the explicit fromNumber arg when supplied (overriding the user's default)", async () => {
    const csv = "+15551234567";
    const spy = makeSpyProvider();
    await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "via brand",
      fromNumber: "MyBrand",
      db,
      provider: spy.provider,
    });

    expect(spy.calls[0]?.from).toBe("MyBrand");
    const msg = (await db.select("messages", { user_id: 1 }))[0];
    expect(msg?.from_number).toBe("MyBrand");
  });

  it("links each recipient to its matching contact (if one exists)", async () => {
    const c1 = await seedContact(db, 1, "+15551234567");
    const c2 = await seedContact(db, 1, "+15551234568");

    const csv = ["+15551234567", "+15551234568", "+15551234599"].join("\n");
    await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    const recipients = await db.select("message_recipients", {});
    const byPhone = new Map(recipients.map((r) => [r.phone, r]));
    expect(byPhone.get("+15551234567")?.contact_id).toBe(c1);
    expect(byPhone.get("+15551234568")?.contact_id).toBe(c2);
    expect(byPhone.get("+15551234599")?.contact_id).toBeNull();
  });
});

// ===========================================================================
// Mixed valid + invalid + opted-out — skipped counter
// ===========================================================================

describe("__sendBulkSmsInternal() — skipped rows (invalid + opted-out)", () => {
  let db: TestDb;
  let provider: import("@/lib/sms").SmsProvider;
  let calls: CallRecord[];

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
    const spy = makeSpyProvider();
    provider = spy.provider;
    calls = spy.calls;
  });

  it("skips an invalid phone row and reports it in the skipped counter", async () => {
    const csv = [
      "+15551234567",
      "not-a-phone", // invalid
      "+15551234568",
    ].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.optedOut).toBe(0);
    expect(result.sent).toBe(2);

    // Provider was called only for the valid rows.
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.to).sort()).toEqual(
      ["+15551234567", "+15551234568"].sort(),
    );

    // 1 message + 2 recipient rows.
    const messages = await db.select("messages", { user_id: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.cost_credits).toBe(2);
    const recipients = await db.select("message_recipients", {});
    expect(recipients).toHaveLength(2);

    // Credits decremented by exactly 2 (the successful count), not 3.
    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(8); // 10 - 2
    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]?.delta).toBe(-2);
  });

  it("skips a phone matching an opted-out contact (same skipped counter)", async () => {
    await seedContact(db, 1, "+15551234567", { optedOut: true });

    const csv = [
      "+15551234567", // opted-out
      "+15551234568",
    ].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.invalid).toBe(0);
    expect(result.optedOut).toBe(1);
    expect(result.sent).toBe(1);

    // Provider called only for the non-opted-out row.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe("+15551234568");

    // Credits decremented by 1 only.
    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(9); // 10 - 1
  });

  it("counts invalid + opted-out together in the skipped counter", async () => {
    await seedContact(db, 1, "+15551234567", { optedOut: true });

    const csv = [
      "+15551234567", // opted-out
      "garbage",      // invalid
      "+15551234568", // valid
    ].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.invalid).toBe(1);
    expect(result.optedOut).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("refuses the entire blast when every row is skipped", async () => {
    const csv = ["not-a-phone", "also-garbage"].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.invalid).toBe(2);
    expect(result.optedOut).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);

    // 1 message row (auditability) but 0 recipient rows + 0 provider calls.
    const messages = await db.select("messages", { user_id: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.cost_credits).toBe(0);
    expect(await db.select("message_recipients", {})).toHaveLength(0);
    expect(calls).toHaveLength(0);

    // Credits untouched.
    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(10);
  });
});

// ===========================================================================
// Validation rejections — must write nothing
// ===========================================================================

describe("__sendBulkSmsInternal() — validation", () => {
  let db: TestDb;
  let provider: import("@/lib/sms").SmsProvider;
  let calls: CallRecord[];

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
    const spy = makeSpyProvider();
    provider = spy.provider;
    calls = spy.calls;
  });

  it("rejects an empty csv and writes nothing", async () => {
    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: "   ",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/csv is required/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects a body longer than 1600 chars and writes nothing", async () => {
    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: "+15551234567",
        body: "x".repeat(1601),
        db,
        provider,
      }),
    ).rejects.toThrow(/1600/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects an empty body and writes nothing", async () => {
    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: "+15551234567",
        body: "",
        db,
        provider,
      }),
    ).rejects.toThrow(/body is required/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects non-positive userId", async () => {
    await expect(
      __sendBulkSmsInternal({
        userId: 0,
        csv: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("rejects a CSV with no phone rows and writes nothing", async () => {
    // All-newlines is treated as 'csv is required' (we couldn't parse
    // anything out of it). Use a header-only CSV for the
    // 'no phone numbers' case below.
    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: "\n\n\n",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/csv is required/);

    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects a CSV with only a header row and writes nothing", async () => {
    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: "phone\n",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/no phone numbers/);

    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects when the user has insufficient credits (need N) and writes nothing", async () => {
    // User has only 1 credit; blast is 3 phones → should fail before any insert.
    await db.update("accounts", { user_id: 1 }, { credits: 1 });

    await expect(
      __sendBulkSmsInternal({
        userId: 1,
        csv: ["+15551234567", "+15551234568", "+15551234569"].join("\n"),
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/need at least 3/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
    expect(await db.select("message_recipients", {})).toHaveLength(0);
    const account = (await db.select("accounts", { user_id: 1 }))[0];
    expect(account?.credits).toBe(1); // unchanged
  });

  it("rejects when no from-number is configured (and none was passed) and writes nothing", async () => {
    await seedUser(db, 7, "no-default@example.com");
    await seedAccount(db, 7, 10);

    await expect(
      __sendBulkSmsInternal({
        userId: 7,
        csv: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/from-number/i);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 7 })).toHaveLength(0);
  });

  it("rejects when the user has no account at all and writes nothing", async () => {
    await seedUser(db, 99, "ghost@example.com", {
      twilioFromNumber: "+15550000099",
    });
    // No account row for user 99.

    await expect(
      __sendBulkSmsInternal({
        userId: 99,
        csv: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/account not found/i);

    expect(calls).toHaveLength(0);
  });
});

// ===========================================================================
// Provider failure path — partial failures: per-recipient failed + no credit
// ===========================================================================

describe("__sendBulkSmsInternal() — provider failure", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
  });

  it("marks the failing recipient as failed and does NOT charge credits for it", async () => {
    const failPhones = new Set<string>(["+15551234568"]);
    const { provider, calls } = makeSpyProvider({ failPhones });

    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv: ["+15551234567", "+15551234568", "+15551234569"].join("\n"),
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(3);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(calls).toHaveLength(3);

    // Recipients: the failing one is marked failed; the other two are sent.
    const recipients = await db.select("message_recipients", {});
    const byPhone = new Map(recipients.map((r) => [r.phone, r]));
    expect(byPhone.get("+15551234567")?.status).toBe("sent");
    expect(byPhone.get("+15551234568")?.status).toBe("failed");
    expect(byPhone.get("+15551234568")?.error_code).toBe("provider_rejected");
    expect(byPhone.get("+15551234569")?.status).toBe("sent");

    // Credits decremented by exactly the success count (2), not 3.
    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(8); // 10 - 2
    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]?.delta).toBe(-2);

    // Message row stays 'sent' (at least one recipient succeeded).
    const message = (await db.select("messages", { user_id: 1 }))[0]!;
    expect(message.status).toBe("sent");
  });

  it("flips the message row to 'failed' when EVERY recipient failed", async () => {
    const failPhones = new Set<string>([
      "+15551234567",
      "+15551234568",
      "+15551234569",
    ]);
    const { provider } = makeSpyProvider({ failPhones });

    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv: ["+15551234567", "+15551234568", "+15551234569"].join("\n"),
      body: "hi",
      db,
      provider,
    });

    expect(result.queued).toBe(3);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(3);

    const message = (await db.select("messages", { user_id: 1 }))[0]!;
    expect(message.status).toBe("failed");
    expect(message.error_code).toBe("provider_rejected");

    // Credits untouched, no credit_transactions row.
    const account = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(account.credits).toBe(10);
    expect(await db.select("credit_transactions", { user_id: 1 })).toHaveLength(
      0,
    );
  });
});

// ===========================================================================
// Public action — auth-gating layer through getTestDb() singleton
// ===========================================================================

describe("sendBulkSmsAction() — public action auth-gating", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("routes through requireUser + getTestDb() singleton and returns the summary", async () => {
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
    __setCurrentUserIdForTests(1);

    const csv = ["+15551234567", "+15551234568"].join("\n");
    const result = await sendBulkSmsAction({
      csv,
      body: "hi via public",
    });

    expect(result.sent).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.messageId).toBeGreaterThan(0);
    expect(result.providerMessageIds).toHaveLength(2);

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages[0]?.status).toBe("sent");
    // The parent messages row intentionally has no twilio_message_sid
    // (one blast → many recipient sids); per-recipient sids are the
    // authoritative link to the upstream provider.
    expect(messages[0]?.twilio_message_sid ?? null).toBeNull();

    // Recipients should each carry their own provider message id.
    const recipients = await db.select("message_recipients", {});
    expect(recipients).toHaveLength(2);
    const sidsOnRecipients = recipients
      .map((r) => r.twilio_message_sid)
      .sort();
    expect(sidsOnRecipients).toEqual([...result.providerMessageIds].sort());
  });

  it("throws when no user is authenticated", async () => {
    await expect(
      sendBulkSmsAction({ csv: "+15551234567", body: "hi" }),
    ).rejects.toThrow();
  });

  it("throws when the user has insufficient credits, leaving the DB untouched", async () => {
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 1);
    __setCurrentUserIdForTests(1);

    await expect(
      sendBulkSmsAction({
        csv: ["+15551234567", "+15551234568"].join("\n"),
        body: "hi",
      }),
    ).rejects.toThrow(/need at least 2/);

    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
    expect(await db.select("message_recipients", {})).toHaveLength(0);
  });
});

// ===========================================================================
// MockSmsProvider integration — verify the singleton wiring actually works
// ===========================================================================

describe("__sendBulkSmsInternal() — integration with MockSmsProvider", () => {
  let db: TestDb;
  let provider: MockSmsProvider;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 10);
    provider = new MockSmsProvider();
  });

  it("calls MockSmsProvider.send for every recipient and stamps the returned providerMessageId", async () => {
    const csv = ["+15551234567", "+15551234568", "+15551234569"].join("\n");
    const result = await __sendBulkSmsInternal({
      userId: 1,
      csv,
      body: "via mock",
      db,
      provider,
    });

    expect(result.sent).toBe(3);
    expect(result.providerMessageIds).toHaveLength(3);

    // Each providerMessageId should be fetchable from the mock.
    for (const id of result.providerMessageIds) {
      const fetched = await provider.fetch(id);
      expect(fetched).not.toBeNull();
      expect(fetched?.providerMessageId).toBe(id);
      expect(fetched?.status).toBe("sent");
    }
  });
});

// ===========================================================================
// Type surface check — ensures the public surface stays compatible with
// the internal call shape.
// ===========================================================================

describe("SendBulkSmsInput type surface", () => {
  it("accepts the documented field set", async () => {
    const db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
    const { provider } = makeSpyProvider();

    // Type-only check: this assignment must compile.
    const input: SendBulkSmsInput = {
      userId: 1,
      csv: "+15551234567",
      body: "hi",
      fromNumber: "+15559999999",
      db,
      provider,
    };
    const result = await __sendBulkSmsInternal(input);
    expect(result.sent).toBe(1);
  });
});