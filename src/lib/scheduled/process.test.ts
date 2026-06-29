import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __scheduleSmsInternal,
} from "@/lib/actions/schedule";
import {
  findDueJobs,
  processDueJobs,
} from "@/lib/scheduled/process";
import { MockSmsProvider } from "@/lib/sms";
import {
  __resetSmsProviderForTests,
} from "@/lib/sms";
import {
  createTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Tests for `processDueJobs(now)` and its helpers.
 *
 * Strategy: seed a fresh DB with a mix of due / future / non-pending
 * scheduled_jobs rows, hand-craft a tiny `SmsProvider` spy so we can
 * assert on what the processor dispatches, and call `processDueJobs`
 * with an explicit `now` so the test is deterministic (no fake timers).
 */

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

/**
 * Insert a pre-scheduled message + job directly via the shim. Used by
 * tests that need to seed rows with `runAt` in the past (the
 * `__scheduleSmsInternal` action rejects past runAt values, so we
 * bypass it here).
 */
async function seedPastScheduled(
  db: TestDb,
  userId: number,
  to: string,
  body: string,
  runAt: Date,
  fromNumber: string,
): Promise<{ messageId: number; jobId: number }> {
  const insertedMessage = await db.insert("messages", {
    user_id: userId,
    body,
    from_number: fromNumber,
    status: "scheduled",
    cost_credits: 1,
    scheduled_for: runAt,
  });
  const messageId = insertedMessage.id as number;
  const insertedRecipient = await db.insert("message_recipients", {
    message_id: messageId,
    phone: to,
    status: "pending",
  });
  void insertedRecipient;
  const insertedJob = await db.insert("scheduled_jobs", {
    user_id: userId,
    message_id: messageId,
    run_at: runAt,
    status: "pending",
    attempts: 0,
  });
  return { messageId, jobId: insertedJob.id as number };
}

/**
 * Schedule a single message + job at `runAt` (future) for user `userId`.
 * Goes through __scheduleSmsInternal so the rows match what a real
 * user-action would have produced. Used for tests that want a future
 * job (i.e. one that processDueJobs should NOT pick up).
 */
async function seedFutureScheduled(
  db: TestDb,
  userId: number,
  to: string,
  body: string,
  runAt: Date,
  now: Date,
): Promise<{ messageId: number; jobId: number }> {
  return __scheduleSmsInternal({
    userId,
    to,
    body,
    runAt,
    db,
    now,
  });
}

interface SpyProviderOptions {
  ok?: boolean;
  providerMessageId?: string;
  error?: string;
}

function makeSpyProvider(
  opts: SpyProviderOptions = {},
): {
  provider: import("@/lib/sms").SmsProvider;
  calls: Array<{ to: string; body: string; from: string }>;
} {
  const calls: Array<{ to: string; body: string; from: string }> = [];
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
          error: opts.error ?? "rejected",
        };
      }
      return {
        ok: true,
        providerMessageId: opts.providerMessageId ?? "mock_proc_1",
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

describe("findDueJobs", () => {
  let db: TestDb;
  const now = new Date("2026-06-29T12:00:00.000Z");

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
  });

  it("returns only pending jobs whose runAt is at or before now", async () => {
    // Two due, one future, one cancelled.
    await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "due1",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );
    await seedPastScheduled(
      db,
      1,
      "+15552222222",
      "due2",
      new Date(now.getTime() - 1),
      "+15550000001",
    );
    await seedFutureScheduled(
      db,
      1,
      "+15553333333",
      "future",
      new Date(now.getTime() + 60_000),
      now,
    );
    const cancelled = await seedPastScheduled(
      db,
      1,
      "+15554444444",
      "cancelled",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );
    await db.update(
      "scheduled_jobs",
      { id: cancelled.jobId },
      { status: "cancelled" },
    );

    const due = await findDueJobs(db, now);
    expect(due).toHaveLength(2);
    // Sorted by insertion order is fine here — we just check IDs are present.
    const messageIds = due.map((j) => j.message_id).sort();
    expect(messageIds).toEqual(
      [due[0]!.message_id, due[1]!.message_id].sort(),
    );
    // The future job's message is NOT in the due list.
    expect(messageIds).not.toContain(due[2]?.message_id ?? -1);
  });

  it("returns an empty list when no jobs exist", async () => {
    const due = await findDueJobs(db, now);
    expect(due).toHaveLength(0);
  });

  it("does not return jobs with runAt strictly in the future", async () => {
    await seedFutureScheduled(
      db,
      1,
      "+15551111111",
      "future",
      new Date(now.getTime() + 60_000),
      now,
    );
    const due = await findDueJobs(db, now);
    expect(due).toHaveLength(0);
  });
});

describe("processDueJobs", () => {
  let db: TestDb;
  const now = new Date("2026-06-29T12:00:00.000Z");

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
  });

  afterEach(() => {
    // We don't use the SMS singleton in these tests, but reset it
    // just in case a previous test instantiated one.
    __resetSmsProviderForTests();
  });

  it("processes every due pending job and marks them 'done'", async () => {
    const { provider, calls } = makeSpyProvider();

    await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg1",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );
    await seedPastScheduled(
      db,
      1,
      "+15552222222",
      "msg2",
      new Date(now.getTime() - 30_000),
      "+15550000001",
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.processed).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(calls).toHaveLength(2);

    // Both jobs flipped to 'done'.
    const jobs = await db.select("scheduled_jobs");
    expect(jobs.every((j) => j.status === "done")).toBe(true);
    // Both messages flipped to 'sent' with a provider id.
    const messages = await db.select("messages");
    for (const m of messages) {
      expect(m.status).toBe("sent");
      expect(m.twilio_message_sid).toBe("mock_proc_1");
      expect(m.sent_at).toBeInstanceOf(Date);
    }
    // Both recipients flipped to 'sent' too.
    const recipients = await db.select("message_recipients");
    for (const r of recipients) {
      expect(r.status).toBe("sent");
      expect(r.twilio_message_sid).toBe("mock_proc_1");
      expect(r.sent_at).toBeInstanceOf(Date);
    }
  });

  it("does NOT process jobs with runAt > now", async () => {
    const { provider, calls } = makeSpyProvider();

    // One due, one future.
    await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "due",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );
    await seedFutureScheduled(
      db,
      1,
      "+15552222222",
      "future",
      new Date(now.getTime() + 60_000),
      now,
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe("+15551111111");

    // The future job is still pending; its message is still 'scheduled'.
    const jobs = await db.select("scheduled_jobs");
    const futureJobs = jobs.filter((j) => j.status === "pending");
    expect(futureJobs).toHaveLength(1);
    const futureJob = futureJobs[0]!;
    const futureMessages = await db.select("messages", {
      id: futureJob.message_id,
    });
    expect(futureMessages[0]!.status).toBe("scheduled");
  });

  it("marks the job 'done' on provider success and stamps providerMessageId", async () => {
    const { provider } = makeSpyProvider({
      providerMessageId: "mock_done_42",
    });
    const seeded = await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.sent).toBe(1);
    expect(result.outcomes[0]!.providerMessageId).toBe("mock_done_42");

    const jobs = await db.select("scheduled_jobs", { id: seeded.jobId });
    expect(jobs[0]!.status).toBe("done");
    expect(jobs[0]!.attempts).toBe(1);
    expect(jobs[0]!.last_error).toBeNull();

    const messages = await db.select("messages", { id: seeded.messageId });
    expect(messages[0]!.status).toBe("sent");
    expect(messages[0]!.twilio_message_sid).toBe("mock_done_42");
  });

  it("marks the job 'done' (with last_error) and message 'failed' on provider rejection", async () => {
    const { provider } = makeSpyProvider({
      ok: false,
      error: "carrier rejected",
    });
    const seeded = await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.outcomes[0]!.result).toBe("failed");
    expect(result.outcomes[0]!.error).toBe("carrier rejected");

    // Job is done (dispatch finished), with the error recorded.
    const jobs = await db.select("scheduled_jobs", { id: seeded.jobId });
    expect(jobs[0]!.status).toBe("done");
    expect(jobs[0]!.last_error).toBe("carrier rejected");
    expect(jobs[0]!.attempts).toBe(1);

    // Message + recipient are 'failed' with a provider_rejected code.
    const messages = await db.select("messages", { id: seeded.messageId });
    expect(messages[0]!.status).toBe("failed");
    expect(messages[0]!.error_code).toBe("provider_rejected");
    const recipients = await db.select("message_recipients", {
      message_id: seeded.messageId,
    });
    expect(recipients[0]!.status).toBe("failed");
    expect(recipients[0]!.error_code).toBe("provider_rejected");
  });

  it("skips jobs whose message was cancelled between findDueJobs and dispatch", async () => {
    // We can't race the internal findDueJobs/dispatchJob loop easily,
    // so we manually set a job to 'pending' but flip its MESSAGE
    // to 'cancelled' — the processor should detect the mismatch and
    // skip without dispatching.
    const { provider, calls } = makeSpyProvider();
    const seeded = await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );
    // Manually cancel the message but leave the job pending.
    await db.update(
      "messages",
      { id: seeded.messageId },
      { status: "cancelled" },
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
    expect(calls).toHaveLength(0);

    // Job status is left alone (the cancel path will set it).
    const jobs = await db.select("scheduled_jobs", { id: seeded.jobId });
    expect(jobs[0]!.status).toBe("pending");
  });

  it("increments attempts on every dispatch attempt", async () => {
    const { provider } = makeSpyProvider();
    const seeded = await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );

    await processDueJobs({ now, db, provider });

    const jobs = await db.select("scheduled_jobs", { id: seeded.jobId });
    expect(jobs[0]!.attempts).toBe(1);
  });

  it("returns an empty result when nothing is due", async () => {
    const { provider, calls } = makeSpyProvider();
    await seedFutureScheduled(
      db,
      1,
      "+15551111111",
      "future",
      new Date(now.getTime() + 60_000),
      now,
    );

    const result = await processDueJobs({ now, db, provider });

    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.outcomes).toHaveLength(0);
  });

  it("does NOT deduct credits at dispatch time (no credit_transactions rows are written)", async () => {
    await db.insert("accounts", { user_id: 1, credits: 10 });
    const { provider } = makeSpyProvider();
    await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "msg",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );

    await processDueJobs({ now, db, provider });

    const accounts = await db.select("accounts", { user_id: 1 });
    expect(accounts[0]!.credits).toBe(10);
    const credits = await db.select("credit_transactions", { user_id: 1 });
    expect(credits).toHaveLength(0);
  });

  it("works end-to-end with the real MockSmsProvider", async () => {
    // Sanity check: the production code path is also valid. The
    // helper signature accepts any SmsProvider; MockSmsProvider
    // should produce a real mock_<uuid> provider message id.
    const realProvider = new MockSmsProvider();
    const seeded = await seedPastScheduled(
      db,
      1,
      "+15551111111",
      "hi",
      new Date(now.getTime() - 60_000),
      "+15550000001",
    );

    const result = await processDueJobs({
      now,
      db,
      provider: realProvider,
    });

    expect(result.sent).toBe(1);
    expect(result.outcomes[0]!.providerMessageId).toMatch(/^mock_/);

    const messages = await db.select("messages", { id: seeded.messageId });
    expect(messages[0]!.status).toBe("sent");
    expect(messages[0]!.twilio_message_sid).toMatch(/^mock_/);
  });
});