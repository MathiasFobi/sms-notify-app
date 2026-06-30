/**
 * `processDueJobs(now)` — the unit-testable core of the scheduled-send
 * worker (US-011).
 *
 * Picks up every `scheduled_jobs` row with `status='pending'` and
 * `runAt <= now`, dispatches each one through `SmsProvider.send()`,
 * stamps the resulting `twilio_message_sid` / `sent_at` on the
 * matching `messages` + `message_recipients` rows, and flips the
 * `scheduled_jobs` row to `status='done'` (or `failed` if the provider
 * rejected the send).
 *
 * The actual worker INVOCATION (cron / queue) is intentionally NOT
 * wired here. That belongs to a later story. This helper is the
 * deterministic, dependency-injected core that:
 *
 *   1. Looks up due jobs.
 *   2. For each job, loads the message + recipient and dispatches it.
 *   3. Returns a summary `{ processed, sent, failed, skipped }` so a
 *      caller can log progress.
 *
 * Implementation notes:
 *
 *   - The processor is given an explicit `provider: SmsProvider` and
 *     `db: TestDb` so unit tests can pass hermetic fakes. Production
 *     callers (the future cron story) will pass `getSmsProvider()`
 *     and `getTestDb()` (or the real Drizzle DB once it's wired).
 *
 *   - "Done" means the dispatch step finished one way or another —
 *     success OR provider-rejected. We use `failed` only if the DB
 *     itself blew up (e.g. the message row vanished between lookup
 *     and update). Anything that came back from the provider, even
 *     a rejection, is treated as a completed dispatch.
 *
 *   - A message that already left `pending` (e.g. cancelled while
 *     we were processing it) is treated as a "skipped" job — the
 *     loop bails on it without dispatching. The DB will reflect
 *     whatever the cancel path set.
 */

import { getSmsProvider, type SmsProvider } from "@/lib/sms";
import type { TestDb, TestRow } from "@/test/db";

// ============================================================================
// Public API
// ============================================================================

export interface ProcessDueJobsInput {
  /** The "now" used to decide which jobs are due. Tests pin this; production passes `new Date()`. */
  now: Date;
  /** The DB to read/write. Tests use a fresh `createTestDb()`; production uses the singleton / Drizzle. */
  db: TestDb;
  /** The SMS provider. Tests pass a stub/spy; production uses `getSmsProvider()`. */
  provider: SmsProvider;
}

export interface ProcessDueJobsResult {
  /** Number of jobs that were acted on (sent, failed, or skipped) in this call. */
  processed: number;
  /** Number of jobs that ended in `status='done'` with the provider accepting the send. */
  sent: number;
  /** Number of jobs that ended in `status='done'` with the provider rejecting the send. */
  failed: number;
  /** Number of jobs that were skipped because the message was no longer in 'scheduled' status. */
  skipped: number;
  /** Per-job outcomes for caller-side logging. */
  outcomes: ProcessDueJobsOutcome[];
}

export interface ProcessDueJobsOutcome {
  jobId: number;
  messageId: number;
  result: "sent" | "failed" | "skipped";
  providerMessageId?: string;
  error?: string;
}

/**
 * Find every `scheduled_jobs` row with `run_at <= now` AND
 * `status='pending'`, dispatch each one, and return a summary.
 *
 * Jobs are processed sequentially — SMS provider rate limits are
 * better handled in the worker invocation (a later cron story)
 * than here. The helper's job is to be deterministic and unit-testable.
 */
export async function processDueJobs(
  input: ProcessDueJobsInput,
): Promise<ProcessDueJobsResult> {
  const { now, db, provider } = input;

  const dueJobs = await findDueJobs(db, now);

  const outcomes: ProcessDueJobsOutcome[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of dueJobs) {
    const outcome = await dispatchJob({ job, db, provider });
    outcomes.push(outcome);
    if (outcome.result === "sent") sent++;
    else if (outcome.result === "failed") failed++;
    else skipped++;
  }

  return {
    processed: outcomes.length,
    sent,
    failed,
    skipped,
    outcomes,
  };
}

// ============================================================================
// Helpers (exported for direct testing if a future story needs them)
// ============================================================================

export interface FindDueJobsInput {
  db: TestDb;
  now: Date;
}

/**
 * Return every `scheduled_jobs` row whose `run_at` is at or before `now`
 * and whose `status` is still `pending`. We scan the in-memory shim's
 * `scheduled_jobs` table directly because the shim has no query builder
 * — Drizzle will replace this once the live DB lands.
 *
 * Future rows (`run_at > now`) and non-pending rows are filtered out
 * by the loop below; this helper returns the candidates and the caller
 * can verify the filter via `processDueJobs`'s test cases.
 */
export async function findDueJobs(
  db: TestDb,
  now: Date,
): Promise<TestScheduledJobRow[]> {
  const allRows = await db.select("scheduled_jobs");
  return allRows.filter((r): r is TestScheduledJobRow => {
    const status = r.status;
    if (status !== "pending") return false;
    const runAt = r.run_at;
    if (!(runAt instanceof Date) || Number.isNaN(runAt.getTime())) return false;
    return runAt.getTime() <= now.getTime();
  });
}

interface TestScheduledJobRow extends TestRow {
  id: number;
  user_id: number;
  message_id: number;
  run_at: Date;
  status: string;
  attempts: number;
  last_error: string | null;
}

interface DispatchJobInput {
  job: TestScheduledJobRow;
  db: TestDb;
  provider: SmsProvider;
}

/**
 * Process one due job:
 *   1. Re-read the message to confirm it's still `scheduled` (the user
 *      may have cancelled it between findDueJobs() and now).
 *   2. Call `provider.send(...)`.
 *   3. Stamp the message + recipient rows from the provider response.
 *   4. Flip the `scheduled_jobs` row to `done` (success) or `failed`
 *      (provider rejected / message row vanished).
 */
async function dispatchJob(input: DispatchJobInput): Promise<ProcessDueJobsOutcome> {
  const { job, db, provider } = input;
  const jobId = job.id;
  const messageId = job.message_id;

  // ---- Re-check the message status (cancel could have raced us) -------

  const messageRows = await db.select("messages", { id: messageId });
  if (messageRows.length === 0) {
    // The message vanished — probably a hard delete. Mark the job
    // failed so it's not retried indefinitely.
    await db.update(
      "scheduled_jobs",
      { id: jobId },
      { status: "failed", last_error: `message ${messageId} not found` },
    );
    return {
      jobId,
      messageId,
      result: "failed",
      error: `message ${messageId} not found`,
    };
  }
  const messageRow = messageRows[0]!;
  if (messageRow.status !== "scheduled") {
    // Likely a cancellation that landed after findDueJobs() but before
    // we got here. Don't dispatch, don't touch the job status — the
    // cancel path already set it to 'cancelled'.
    return {
      jobId,
      messageId,
      result: "skipped",
      error: `message status is '${String(messageRow.status)}', not 'scheduled'`,
    };
  }

  // ---- Load the recipient row (we expect exactly one for scheduled
  //      single-sends; bulk scheduled sends come in a later story) ---

  const recipientRows = await db.select("message_recipients", {
    message_id: messageId,
  });
  if (recipientRows.length === 0) {
    await db.update(
      "scheduled_jobs",
      { id: jobId },
      {
        status: "failed",
        last_error: `no recipients found for message ${messageId}`,
      },
    );
    return {
      jobId,
      messageId,
      result: "failed",
      error: `no recipients found for message ${messageId}`,
    };
  }
  const recipientRow = recipientRows[0]!;
  const to = String(recipientRow.phone);
  const body = String(messageRow.body);
  const from = String(messageRow.from_number);

  // ---- Bump attempts on the job (always — even if the provider fails).
  //      Real workers also persist attempts so the dashboard can show
  //      "retried 3 times before giving up". ----
  await db.update(
    "scheduled_jobs",
    { id: jobId },
    { attempts: (job.attempts ?? 0) + 1 },
  );

  // ---- Dispatch ---------------------------------------------------------

  let result;
  try {
    result = await provider.send({ to, body, from });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.update(
      "scheduled_jobs",
      { id: jobId },
      { status: "failed", last_error: errorMessage },
    );
    return { jobId, messageId, result: "failed", error: errorMessage };
  }

  if (!result.ok || !result.providerMessageId) {
    // Provider rejected the send. Flip message + recipient to 'failed'
    // (consistent with the immediate-send action in src/lib/actions/send.ts)
    // and the job to 'done' (the dispatch attempt finished, just
    // unsuccessfully). NO credit deduction — that's owned by the
    // immediate-send action's path; scheduled dispatches happen later
    // and will be charged by a future billing hook.
    const errorMessage = result.error ?? "provider rejected the send";
    const nowDate = new Date();
    await db.update(
      "messages",
      { id: messageId },
      {
        status: "failed",
        error_code: "provider_rejected",
        sent_at: nowDate,
      },
    );
    await db.update(
      "message_recipients",
      { id: recipientRow.id as number },
      {
        status: "failed",
        error_code: "provider_rejected",
        sent_at: nowDate,
      },
    );
    await db.update(
      "scheduled_jobs",
      { id: jobId },
      { status: "done", last_error: errorMessage },
    );
    return {
      jobId,
      messageId,
      result: "failed",
      error: errorMessage,
    };
  }

  // ---- Success path -----------------------------------------------------

  const providerMessageId = result.providerMessageId;
  const nowDate = new Date();
  await db.update(
    "messages",
    { id: messageId },
    {
      status: "sent",
      twilio_message_sid: providerMessageId,
      sent_at: nowDate,
    },
  );
  await db.update(
    "message_recipients",
    { id: recipientRow.id as number },
    {
      status: "sent",
      twilio_message_sid: providerMessageId,
      sent_at: nowDate,
    },
  );
  await db.update(
    "scheduled_jobs",
    { id: jobId },
    { status: "done", last_error: null },
  );

  return {
    jobId,
    messageId,
    result: "sent",
    providerMessageId,
  };
}

// ============================================================================
// Production convenience wrapper
// ============================================================================

/**
 * Production-side helper: `processDueJobs` with the default provider
 * and singleton DB. The future cron story will call this from a
 * scheduled task handler.
 */
export async function processDueJobsForProduction(
  now: Date,
): Promise<ProcessDueJobsResult> {
  return processDueJobs({
    now,
    db: (await import("@/test/db")).getTestDb(),
    provider: getSmsProvider(),
  });
}