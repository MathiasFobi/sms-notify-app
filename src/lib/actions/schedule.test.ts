import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __cancelScheduledInternal,
  __scheduleSmsInternal,
  cancelScheduledAction,
  scheduleSmsAction,
} from "@/lib/actions/schedule";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";

/**
 * Test seeding helpers. Each describe that exercises the internal
 * helpers gets a fresh `createTestDb()` for full isolation; tests
 * that go through the public action seed through the singleton
 * (matching the convention from send.test.ts / bulk-send.test.ts).
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

describe("__scheduleSmsInternal", () => {
  let db: TestDb;
  let now: Date;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", { twilioFromNumber: "+15550000001" });
    now = new Date("2026-06-29T12:00:00.000Z");
  });

  it("inserts a messages row with status='scheduled' and a scheduled_jobs row with status='pending'", async () => {
    const runAt = new Date(now.getTime() + 60 * 60 * 1000); // +1h
    const result = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hello future",
      runAt,
      db,
      now,
    });

    expect(result.messageId).toBeGreaterThan(0);
    expect(result.jobId).toBeGreaterThan(0);

    const messages = await db.select("messages", { id: result.messageId });
    expect(messages).toHaveLength(1);
    const message = messages[0]!;
    expect(message.status).toBe("scheduled");
    expect(message.body).toBe("Hello future");
    expect(message.from_number).toBe("+15550000001");
    expect(message.user_id).toBe(1);
    expect((message.scheduled_for as Date).toISOString()).toBe(
      runAt.toISOString(),
    );

    const jobs = await db.select("scheduled_jobs", { id: result.jobId });
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!;
    expect(job.status).toBe("pending");
    expect(job.message_id).toBe(result.messageId);
    expect(job.user_id).toBe(1);
    expect((job.run_at as Date).toISOString()).toBe(runAt.toISOString());
    expect(job.attempts).toBe(0);
  });

  it("does NOT call the SMS provider at scheduling time (no provider arg on the internal)", async () => {
    // The internal signature deliberately doesn't take a provider —
    // scheduling is a pure DB write. The actual dispatch happens
    // later in processDueJobs() (see process.test.ts).
    // We assert here that no DB writes accidentally triggered a
    // provider call by checking the shim's mock send counter is
    // untouched.
    const spy = vi.fn();
    const freshDb = createTestDb();
    await seedUser(freshDb, 1, "alice@example.com", {
      twilioFromNumber: "+15550000001",
    });
    // Hook into the shim's "send" path by intercepting any future
    // getSmsProvider() singleton — but since __scheduleSmsInternal
    // never calls getSmsProvider(), this spy MUST remain at 0.
    const mod = await import("@/lib/sms");
    const originalProvider = mod.getSmsProvider();
    const originalSend = originalProvider.send.bind(originalProvider);
    originalProvider.send = async (msg) => {
      spy(msg);
      return originalSend(msg);
    };
    try {
      await __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime() + 60_000),
        db: freshDb,
        now,
      });
    } finally {
      originalProvider.send = originalSend as typeof originalProvider.send;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("does NOT deduct credits at scheduling time", async () => {
    await db.insert("accounts", { user_id: 1, credits: 10 });
    await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    const accounts = await db.select("accounts", { user_id: 1 });
    expect(accounts[0]!.credits).toBe(10);
    const credits = await db.select("credit_transactions", { user_id: 1 });
    expect(credits).toHaveLength(0);
  });

  it("normalizes the 'to' phone number before insert", async () => {
    const result = await __scheduleSmsInternal({
      userId: 1,
      to: "(555) 123-4567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    const recipients = await db.select("message_recipients", {
      message_id: result.messageId,
    });
    expect(recipients).toHaveLength(1);
    expect(recipients[0]!.phone).toBe("+15551234567");
  });

  it("accepts a runAt provided as an ISO string", async () => {
    const iso = new Date(now.getTime() + 60_000).toISOString();
    const result = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: iso,
      db,
      now,
    });
    const jobs = await db.select("scheduled_jobs", { id: result.jobId });
    expect((jobs[0]!.run_at as Date).toISOString()).toBe(iso);
  });

  it("rejects scheduling in the past with a clear error", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime() - 1000),
        db,
        now,
      }),
    ).rejects.toThrow(/runAt must be in the future/);

    // And confirms no rows were written.
    const messages = await db.select("messages");
    expect(messages.filter((m) => m.status === "scheduled")).toHaveLength(0);
    const jobs = await db.select("scheduled_jobs");
    expect(jobs).toHaveLength(0);
  });

  it("rejects scheduling at exactly 'now'", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime()),
        db,
        now,
      }),
    ).rejects.toThrow(/runAt must be in the future/);
  });

  it("rejects invalid runAt values", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        // Cast through unknown — the runtime parser is what matters.
        runAt: "not-a-date" as unknown as string,
        db,
        now,
      }),
    ).rejects.toThrow(/not a valid date/);
  });

  it("rejects non-positive userId", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 0,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow(/userId must be a positive integer/);
  });

  it("rejects empty body", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "",
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow(/body is required/);
  });

  it("rejects bodies longer than 1600 characters", async () => {
    const huge = "x".repeat(1601);
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: huge,
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow(/1600/);
  });

  it("rejects missing/invalid 'to' phone numbers", async () => {
    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "abc",
        body: "Hi",
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow();
  });

  it("rejects when no from-number is configured and none is passed", async () => {
    // Wipe the user's from-number.
    await db.update("users", { id: 1 }, { twilio_from_number: null });

    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow(/no from-number configured/);
  });

  it("uses the explicit fromNumber argument when provided (overriding the user's default)", async () => {
    const result = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      fromNumber: "+15559999999",
      db,
      now,
    });
    const messages = await db.select("messages", { id: result.messageId });
    expect(messages[0]!.from_number).toBe("+15559999999");
  });

  it("rejects when the contact has opted out", async () => {
    await db.insert("contacts", {
      user_id: 1,
      phone: "+15551234567",
      opted_out: true,
    });

    await expect(
      __scheduleSmsInternal({
        userId: 1,
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(now.getTime() + 60_000),
        db,
        now,
      }),
    ).rejects.toThrow(/opted out/);

    const messages = await db.select("messages");
    expect(messages).toHaveLength(0);
    const jobs = await db.select("scheduled_jobs");
    expect(jobs).toHaveLength(0);
  });

  it("does not leak scheduled rows across users", async () => {
    const r1 = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    // Re-querying should only surface this user's row.
    const allJobs = await db.select("scheduled_jobs");
    expect(allJobs).toHaveLength(1);
    expect(allJobs[0]!.id).toBe(r1.jobId);
    expect(allJobs[0]!.user_id).toBe(1);
  });
});

describe("scheduleSmsAction (public, auth-gated)", () => {
  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    const db = getTestDb();
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

  it("uses requireUser to scope the schedule to the current user", async () => {
    const runAt = new Date(Date.now() + 60_000);
    const result = await scheduleSmsAction({
      to: "+15551234567",
      body: "Hi",
      runAt,
    });
    expect(result.messageId).toBeGreaterThan(0);
    expect(result.jobId).toBeGreaterThan(0);

    const db = getTestDb();
    const messages = await db.select("messages", { id: result.messageId });
    expect(messages[0]!.user_id).toBe(1);
  });

  it("rejects when no user is authenticated via the requireUser override", async () => {
    // requireUser() uses the override if set. Setting it to 0 (which
    // doesn't exist in the DB) exercises the "user not found" branch
    // — same observable effect as "no auth" from the caller's POV.
    __setCurrentUserIdForTests(0);
    await expect(
      scheduleSmsAction({
        to: "+15551234567",
        body: "Hi",
        runAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow(/Unauthorized|user.*not found/i);
  });
});

describe("__cancelScheduledInternal", () => {
  let db: TestDb;
  let now: Date;

  beforeEach(async () => {
    db = createTestDb();
    await seedUser(db, 1, "alice@example.com", { twilioFromNumber: "+15550000001" });
    await seedUser(db, 2, "bob@example.com", { twilioFromNumber: "+15550000002" });
    now = new Date("2026-06-29T12:00:00.000Z");
  });

  it("marks the message and the matching job 'cancelled'", async () => {
    const scheduled = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    const result = await __cancelScheduledInternal({
      userId: 1,
      messageId: scheduled.messageId,
      db,
    });

    expect(result.messageId).toBe(scheduled.messageId);
    expect(result.jobId).toBe(scheduled.jobId);

    const messages = await db.select("messages", { id: scheduled.messageId });
    expect(messages[0]!.status).toBe("cancelled");

    const jobs = await db.select("scheduled_jobs", { id: scheduled.jobId });
    expect(jobs[0]!.status).toBe("cancelled");
  });

  it("rejects cancelling a message that doesn't exist", async () => {
    await expect(
      __cancelScheduledInternal({
        userId: 1,
        messageId: 99999,
        db,
      }),
    ).rejects.toThrow(/not found/);
  });

  it("rejects cancelling another user's message with the same 'not found' message (no existence leak)", async () => {
    const otherMessage = await __scheduleSmsInternal({
      userId: 2,
      to: "+15553333333",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    await expect(
      __cancelScheduledInternal({
        userId: 1,
        messageId: otherMessage.messageId,
        db,
      }),
    ).rejects.toThrow(/not found/);

    // And the other user's row is untouched.
    const messages = await db.select("messages", { id: otherMessage.messageId });
    expect(messages[0]!.status).toBe("scheduled");
    const jobs = await db.select("scheduled_jobs", { id: otherMessage.jobId });
    expect(jobs[0]!.status).toBe("pending");
  });

  it("rejects cancelling a message that's already been sent", async () => {
    const scheduled = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    // Simulate the message already being sent.
    await db.update(
      "messages",
      { id: scheduled.messageId },
      { status: "sent" },
    );

    await expect(
      __cancelScheduledInternal({
        userId: 1,
        messageId: scheduled.messageId,
        db,
      }),
    ).rejects.toThrow(/not cancellable/);
  });

  it("rejects cancelling a message that's already cancelled (idempotency-safe error)", async () => {
    const scheduled = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    await __cancelScheduledInternal({
      userId: 1,
      messageId: scheduled.messageId,
      db,
    });

    await expect(
      __cancelScheduledInternal({
        userId: 1,
        messageId: scheduled.messageId,
        db,
      }),
    ).rejects.toThrow(/not cancellable/);
  });

  it("rejects non-positive messageId / userId", async () => {
    await expect(
      __cancelScheduledInternal({ userId: 1, messageId: 0, db }),
    ).rejects.toThrow(/messageId must be a positive integer/);

    await expect(
      __cancelScheduledInternal({ userId: 0, messageId: 1, db }),
    ).rejects.toThrow(/userId must be a positive integer/);
  });
});

describe("cancelScheduledAction (public, auth-gated)", () => {
  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    const db = getTestDb();
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

  it("cancels via the public action for the current user", async () => {
    const db = getTestDb();
    const now = new Date();
    // Schedule directly against the singleton (the public action
    // would also work, but going through __scheduleSmsInternal
    // avoids an extra requireUser() hop here).
    const scheduled = await __scheduleSmsInternal({
      userId: 1,
      to: "+15551234567",
      body: "Hi",
      runAt: new Date(now.getTime() + 60_000),
      db,
      now,
    });

    const result = await cancelScheduledAction({
      messageId: scheduled.messageId,
    });

    expect(result.messageId).toBe(scheduled.messageId);
    expect(result.jobId).toBe(scheduled.jobId);

    const messages = await db.select("messages", { id: scheduled.messageId });
    expect(messages[0]!.status).toBe("cancelled");
  });

  it("rejects when no user is authenticated via the requireUser override", async () => {
    // Same approach as the schedule test above — set the override to
    // a non-existent user id to exercise the "user not found" branch.
    __setCurrentUserIdForTests(0);
    await expect(cancelScheduledAction({ messageId: 1 })).rejects.toThrow(
      /Unauthorized|user.*not found/i,
    );
  });
});

// ============================================================================
// Surface check — keep the public + internal exports stable
// ============================================================================

describe("public surface", () => {
  it("exports scheduleSmsAction and cancelScheduledAction", () => {
    expect(typeof scheduleSmsAction).toBe("function");
    expect(typeof cancelScheduledAction).toBe("function");
  });

  it("exports __scheduleSmsInternal and __cancelScheduledInternal", () => {
    expect(typeof __scheduleSmsInternal).toBe("function");
    expect(typeof __cancelScheduledInternal).toBe("function");
  });
});