import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __sendSmsInternal,
  sendSmsAction,
  type SendSmsInput,
} from "@/lib/actions/send";
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
 * public `sendSmsAction` (which goes through `getTestDb()`) seed via
 * the singleton instead, matching the pattern from sender-ids /
 * contact-groups / contacts test files.
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
  ok?: boolean;
  error?: string;
} = {}): {
  provider: import("@/lib/sms").SmsProvider;
  calls: CallRecord[];
} {
  const calls: CallRecord[] = [];
  const provider: import("@/lib/sms").SmsProvider = {
    async send(message) {
      calls.push({
        to: message.to,
        body: message.body,
        from: message.from ?? "",
      });
      const ok = opts.ok ?? true;
      if (!ok) {
        return {
          ok: false,
          priceUsd: 0,
          segments: 0,
          error: opts.error ?? "test failure",
        };
      }
      return {
        ok: true,
        providerMessageId:
          opts.providerMessageId ?? "mock_test-message-id",
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
// __sendSmsInternal — exercised directly with a fresh in-memory DB.
// ===========================================================================

describe("__sendSmsInternal() — happy path", () => {
  let db: TestDb;
  let provider: import("@/lib/sms").SmsProvider;
  let calls: CallRecord[];

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
    const spy = makeSpyProvider({ providerMessageId: "mock_abc-123" });
    provider = spy.provider;
    calls = spy.calls;
  });

  it("inserts one messages row and one message_recipients row with status='sent'", async () => {
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "hello world",
      db,
      provider,
    });

    expect(result.providerMessageId).toBe("mock_abc-123");
    expect(result.messageId).toBeTypeOf("number");
    expect(result.recipientId).toBeTypeOf("number");

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: result.messageId,
      user_id: 1,
      body: "hello world",
      from_number: "+15550000001",
      status: "sent",
      cost_credits: 1,
      twilio_message_sid: "mock_abc-123",
    });

    const recipients = await db.select("message_recipients", {
      message_id: result.messageId,
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      id: result.recipientId,
      message_id: result.messageId,
      phone: "+15551234567",
      status: "sent",
      twilio_message_sid: "mock_abc-123",
    });
  });

  it("decrements accounts.credits by 1 and writes a credit_transactions row with reason='send'", async () => {
    const before = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(before.credits).toBe(5);

    await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "hello world",
      db,
      provider,
    });

    const after = (await db.select("accounts", { user_id: 1 }))[0]!;
    expect(after.credits).toBe(4);

    const txns = await db.select("credit_transactions", { user_id: 1 });
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({
      user_id: 1,
      delta: -1,
      reason: "send",
    });
  });

  it("calls provider.send exactly once with the user-supplied body and recipient", async () => {
    await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "important update",
      db,
      provider,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      to: "+15551234567",
      body: "important update",
      from: "+15550000001",
    });
  });

  it("normalizes the 'to' phone before persisting + provider call", async () => {
    await __sendSmsInternal({
      userId: 1,
      to: "(555) 123-4567",
      body: "hi",
      db,
      provider,
    });

    expect(calls[0]?.to).toBe("+15551234567");
    const recipients = await db.select("message_recipients", {});
    expect(recipients[0]?.phone).toBe("+15551234567");
  });

  it("uses the explicit fromNumber arg when supplied (overriding the user's default)", async () => {
    await seedUser(db, 2, "carol@example.com", {
      twilioFromNumber: "+15550000099",
    });
    await seedAccount(db, 2, 5);

    const spy = makeSpyProvider();
    await __sendSmsInternal({
      userId: 2,
      to: "+15551234567",
      body: "via brand",
      fromNumber: "MyBrand",
      db,
      provider: spy.provider,
    });

    expect(spy.calls[0]?.from).toBe("MyBrand");
    const msg = (await db.select("messages", { user_id: 2 }))[0];
    expect(msg?.from_number).toBe("MyBrand");
  });

  it("links the message_recipient to the matching contact (if one exists)", async () => {
    const contactId = await seedContact(db, 1, "+15551234567", {
      optedOut: false,
    });

    await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "hi",
      db,
      provider,
    });

    const recipients = await db.select("message_recipients", {});
    expect(recipients[0]?.contact_id).toBe(contactId);
  });

  it("stamps sent_at on both rows from a Date instance", async () => {
    await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "hi",
      db,
      provider,
    });

    const msg = (await db.select("messages", { user_id: 1 }))[0];
    expect(msg?.sent_at).toBeInstanceOf(Date);

    const recipient = (await db.select("message_recipients", {}))[0];
    expect(recipient?.sent_at).toBeInstanceOf(Date);
  });

  it("accepts a body of exactly 1600 chars", async () => {
    const body = "x".repeat(1600);
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body,
      db,
      provider,
    });
    expect(result.messageId).toBeGreaterThan(0);
    expect(calls[0]?.body).toHaveLength(1600);
  });
});

// ===========================================================================
// Validation rejections — must write nothing
// ===========================================================================

describe("__sendSmsInternal() — validation", () => {
  let db: TestDb;
  let provider: import("@/lib/sms").SmsProvider;
  let calls: CallRecord[];

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
    const spy = makeSpyProvider();
    provider = spy.provider;
    calls = spy.calls;
  });

  it("rejects a body longer than 1600 chars and writes nothing", async () => {
    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "x".repeat(1601),
        db,
        provider,
      }),
    ).rejects.toThrow(/1600/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
    expect(await db.select("message_recipients", {})).toHaveLength(0);
    expect(await db.select("credit_transactions", { user_id: 1 })).toHaveLength(
      0,
    );
    const account = (await db.select("accounts", { user_id: 1 }))[0];
    expect(account?.credits).toBe(5); // unchanged
  });

  it("rejects an empty body and writes nothing", async () => {
    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "",
        db,
        provider,
      }),
    ).rejects.toThrow(/body is required/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects an unparseable 'to' and writes nothing", async () => {
    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "not-a-phone",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/invalid characters|too short|valid/i);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects an empty 'to' and writes nothing", async () => {
    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/to is required/);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });

  it("rejects sending to an opted-out contact and writes nothing", async () => {
    await seedContact(db, 1, "+15551234567", { optedOut: true });

    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/opted out/i);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
    expect(await db.select("message_recipients", {})).toHaveLength(0);
    expect(await db.select("credit_transactions", { user_id: 1 })).toHaveLength(
      0,
    );
    const account = (await db.select("accounts", { user_id: 1 }))[0];
    expect(account?.credits).toBe(5); // unchanged
  });

  it("rejects when the user has no credits and writes nothing", async () => {
    // Drop credits to 0.
    await db.update("accounts", { user_id: 1 }, { credits: 0 });

    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/no credits/i);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
    expect(await db.select("credit_transactions", { user_id: 1 })).toHaveLength(
      0,
    );
  });

  it("rejects when the user has no account at all and writes nothing", async () => {
    // User 99 has no account row.
    await seedUser(db, 99, "ghost@example.com", {
      twilioFromNumber: "+15550000099",
    });

    await expect(
      __sendSmsInternal({
        userId: 99,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/account not found/i);

    expect(calls).toHaveLength(0);
  });

  it("rejects when no from-number is configured (and none was passed) and writes nothing", async () => {
    // User with no twilio_from_number and no explicit arg.
    await seedUser(db, 7, "no-default@example.com");
    await seedAccount(db, 7, 5);

    await expect(
      __sendSmsInternal({
        userId: 7,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/from-number/i);

    expect(calls).toHaveLength(0);
    expect(await db.select("messages", { user_id: 7 })).toHaveLength(0);
  });

  it("rejects non-positive userId", async () => {
    await expect(
      __sendSmsInternal({
        userId: 0,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/positive integer/);
  });

  it("does NOT refuse sending to a non-opted-out contact", async () => {
    await seedContact(db, 1, "+15551234567", { optedOut: false });
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "hi",
      db,
      provider,
    });
    expect(result.messageId).toBeGreaterThan(0);
  });

  it("does NOT refuse sending to a phone that has no contact record at all", async () => {
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15559999999",
      body: "hi",
      db,
      provider,
    });
    expect(result.messageId).toBeGreaterThan(0);
    const recipients = await db.select("message_recipients", {});
    expect(recipients[0]?.contact_id).toBeNull();
  });
});

// ===========================================================================
// Provider failure path — rows are kept but marked failed, credits NOT deducted
// ===========================================================================

describe("__sendSmsInternal() — provider failure", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
  });

  it("keeps the message + recipient rows (status='failed') but does NOT deduct credits", async () => {
    const { provider, calls } = makeSpyProvider({
      ok: false,
      error: "carrier down",
    });

    await expect(
      __sendSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "hi",
        db,
        provider,
      }),
    ).rejects.toThrow(/provider rejected/);

    expect(calls).toHaveLength(1);

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      status: "failed",
      error_code: "provider_rejected",
    });

    const recipients = await db.select("message_recipients", {});
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      status: "failed",
      error_code: "provider_rejected",
    });

    // Credits unchanged.
    const account = (await db.select("accounts", { user_id: 1 }))[0];
    expect(account?.credits).toBe(5);
    expect(await db.select("credit_transactions", { user_id: 1 })).toHaveLength(
      0,
    );
  });
});

// ===========================================================================
// Public action — auth-gating layer through getTestDb() singleton
// ===========================================================================

describe("sendSmsAction() — public action auth-gating", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("routes through requireUser + getTestDb() singleton and returns the providerMessageId", async () => {
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
    __setCurrentUserIdForTests(1);

    const result = await sendSmsAction({
      to: "+15551234567",
      body: "hello via public action",
    });

    expect(result.providerMessageId).toMatch(/^mock_[0-9a-f-]{36}$/);
    expect(result.messageId).toBeGreaterThan(0);
    expect(result.recipientId).toBeGreaterThan(0);

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages[0]?.status).toBe("sent");
    expect(messages[0]?.twilio_message_sid).toBe(result.providerMessageId);
  });

  it("throws when no user is authenticated", async () => {
    // No __setCurrentUserIdForTests call → requireUser has no override
    // and no cookie in jsdom. `cookies()` from next/headers throws
    // "outside a request scope" in the test env — that propagates as
    // the action's rejection, which is the same observable behavior
    // the user sees in production when no cookie is present. We just
    // assert that it throws; the exact message comes from Next.js.
    await expect(
      sendSmsAction({ to: "+15551234567", body: "hi" }),
    ).rejects.toThrow();
  });

  it("throws when the user has no credits, leaving the DB untouched", async () => {
    const db = getTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 0);
    __setCurrentUserIdForTests(1);

    await expect(
      sendSmsAction({ to: "+15551234567", body: "hi" }),
    ).rejects.toThrow(/no credits/i);

    expect(await db.select("messages", { user_id: 1 })).toHaveLength(0);
  });
});

// ===========================================================================
// MockSmsProvider integration — verify the singleton wiring actually works
// ===========================================================================

describe("__sendSmsInternal() — integration with MockSmsProvider", () => {
  let db: TestDb;
  let provider: MockSmsProvider;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 5);
    provider = new MockSmsProvider();
    sendSpy = vi.spyOn(provider, "send");
  });

  it("calls MockSmsProvider.send exactly once and persists the returned providerMessageId", async () => {
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "via mock",
      db,
      provider,
    });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith({
      to: "+15551234567",
      body: "via mock",
      from: "+15550000001",
    });
    expect(result.providerMessageId).toMatch(/^mock_[0-9a-f-]{36}$/);

    const messages = await db.select("messages", { user_id: 1 });
    expect(messages[0]?.twilio_message_sid).toBe(result.providerMessageId);
  });

  it("can fetch the sent message back via provider.fetch(providerMessageId)", async () => {
    const result = await __sendSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "round-trip",
      db,
      provider,
    });

    const fetched = await provider.fetch(result.providerMessageId);
    expect(fetched).not.toBeNull();
    expect(fetched?.providerMessageId).toBe(result.providerMessageId);
    expect(fetched?.status).toBe("sent");
  });
});

// ===========================================================================
// sendSmsInput type-shape check — ensures the public surface stays
// compatible with the internal call shape (cheap compile-time-ish check
// via a no-op call).
// ===========================================================================

describe("SendSmsInput type surface", () => {
  it("accepts the documented field set", async () => {
    const db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    await seedAccount(db, 1, 1);
    const { provider } = makeSpyProvider();

    // Type-only check: this assignment must compile.
    const input: SendSmsInput = {
      userId: 1,
      to: "+15551234567",
      body: "hi",
      fromNumber: "+15559999999",
      db,
      provider,
    };
    const result = await __sendSmsInternal(input);
    expect(result.providerMessageId).toBeTypeOf("string");
  });
});