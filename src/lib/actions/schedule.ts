"use server";

/**
 * Server actions for scheduled SMS sends (`/app/scheduled`).
 *
 * - `scheduleSmsAction({ to, body, runAt, fromNumber? })` — schedule
 *   a single-recipient SMS for delivery at a future `runAt`. Mirrors
 *   `sendSmsAction` (US-009) but instead of calling the provider now,
 *   we insert a `messages` row with `status='scheduled'` + a matching
 *   `scheduled_jobs` row with `status='pending'`. The actual dispatch
 *   happens later in `processDueJobs(now)` (see
 *   `src/lib/scheduled/process.ts`), which is owned by a future cron
 *   story.
 *
 *   Validation order (cheap first, no DB writes on the failure paths):
 *
 *     1. `userId` is a positive integer.
 *     2. `body` is a non-empty string and ≤ 1600 characters (same
 *        SMS multipart hard cap as the immediate-send action).
 *     3. `to` is a non-empty E.164-ish phone (normalized via
 *        `normalizePhone`).
 *     4. `runAt` parses to a valid Date and is in the FUTURE. Past
 *        `runAt` values are rejected — scheduling "for last Tuesday"
 *        is almost always a UI bug and a silent no-op if we let it
 *        through.
 *     5. The user has a from-number configured (explicit `fromNumber`
 *        arg or `users.twilio_from_number`). No credits are deducted
 *        at schedule time — credits are charged when the worker
 *        actually dispatches the message.
 *
 *   NOTE: opt-out checks happen at SCHEDULE time (so a known-opted-out
 *   contact can't even be queued), but a user can still schedule a
 *   message to a phone they don't have a contact for.
 *
 * - `cancelScheduledAction({ messageId })` — flip the `messages` row
 *   to `status='cancelled'` AND the matching `scheduled_jobs` row to
 *   `status='cancelled'`. Throws if the row doesn't exist or belongs
 *   to another user. Already-sent messages are not cancellable.
 *
 * The actual DB work is delegated to `__scheduleSmsInternal` /
 * `__cancelScheduledInternal`, exported with the `__` prefix so unit
 * tests can drive them with a fresh `TestDb` (no singleton coupling,
 * no `requireUser()` plumbing).
 */

import { requireUser } from "@/lib/auth/require-user";
import { normalizePhone } from "@/lib/phone";
import { getTestDb, type TestDb } from "@/test/db";

// NOTE: This is a `"use server"` file. Next.js 16 only allows async
// functions (and type-only exports) from such files — re-exporting
// schema table objects would fail the build. Importers grab the
// schema directly from "@/db/schema" instead.

const MAX_BODY_CHARS = 1600;

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Schedule a single SMS for delivery at a future `runAt`.
 *
 * Returns the inserted `messageId` and the `jobId` of the matching
 * `scheduled_jobs` row. No provider call happens at this point;
 * `processDueJobs(now)` (see `src/lib/scheduled/process.ts`) will
 * pick it up once `runAt` is in the past.
 */
export async function scheduleSmsAction(args: {
  to: string;
  body: string;
  runAt: Date | string;
  fromNumber?: string;
}): Promise<{
  messageId: number;
  jobId: number;
}> {
  const user = await requireUser();
  return __scheduleSmsInternal({
    userId: user.id,
    to: args.to,
    body: args.body,
    runAt: args.runAt,
    fromNumber: args.fromNumber,
    db: getTestDb(),
    now: new Date(),
  });
}

/**
 * Cancel a pending scheduled send. Sets `messages.status='cancelled'`
 * AND the matching `scheduled_jobs.status='cancelled'`.
 *
 * Throws if:
 *   - the message doesn't exist or belongs to another user
 *   - the message is not currently in `scheduled` status (already sent,
 *     already cancelled, or otherwise non-pending)
 */
export async function cancelScheduledAction(args: {
  messageId: number;
}): Promise<{ messageId: number; jobId: number }> {
  const user = await requireUser();
  return __cancelScheduledInternal({
    userId: user.id,
    messageId: args.messageId,
    db: getTestDb(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface ScheduleSmsInput {
  userId: number;
  to: string;
  body: string;
  /** Either a `Date` or any value `new Date()` can parse (string, number). */
  runAt: Date | string;
  fromNumber?: string;
  db: TestDb;
  /**
   * The "current time" used for the past-runAt rejection. Tests pass an
   * explicit Date so they can schedule relative to a fixed clock; the
   * public action defaults to `new Date()`.
   */
  now: Date;
}

export interface ScheduleSmsResult {
  messageId: number;
  jobId: number;
}

/**
 * Insert a `messages` row (`status='scheduled'`) and a matching
 * `scheduled_jobs` row (`status='pending'`). No provider call, no
 * credit deduction.
 */
export async function __scheduleSmsInternal(
  input: ScheduleSmsInput,
): Promise<ScheduleSmsResult> {
  const { userId, to, body, runAt, fromNumber, db, now } = input;

  // ---- Validation (cheap first, no DB writes) ---------------------------

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("scheduleSms: userId must be a positive integer");
  }
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("scheduleSms: body is required");
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new Error(
      `scheduleSms: body is ${body.length} characters; maximum is ${MAX_BODY_CHARS}`,
    );
  }

  const normalizedTo = normalizePhone(to);
  if (normalizedTo === null || normalizedTo.length === 0) {
    throw new Error("scheduleSms: to is required");
  }

  const runAtDate =
    runAt instanceof Date ? runAt : new Date(runAt as string | number);
  if (Number.isNaN(runAtDate.getTime())) {
    throw new Error(`scheduleSms: runAt is not a valid date: ${String(runAt)}`);
  }
  if (runAtDate.getTime() <= now.getTime()) {
    throw new Error(
      `scheduleSms: runAt must be in the future; got ${runAtDate.toISOString()}, now is ${now.toISOString()}`,
    );
  }

  // ---- Opt-out check (no rows written if it fails) ----------------------

  const contactRows = await db.select("contacts", {
    user_id: userId,
    phone: normalizedTo,
  });
  if (contactRows.length > 0) {
    const contact = contactRows[0]!;
    if (contact.opted_out === true) {
      throw new Error(
        `scheduleSms: contact ${contact.id} (${normalizedTo}) has opted out`,
      );
    }
  }

  // ---- Resolve from-number (no rows written if it fails) ----------------

  let resolvedFrom: string;
  if (typeof fromNumber === "string" && fromNumber.trim().length > 0) {
    resolvedFrom = fromNumber.trim();
  } else {
    const userRows = await db.select("users", { id: userId });
    const userFrom = userRows[0]?.twilio_from_number;
    if (typeof userFrom !== "string" || userFrom.length === 0) {
      throw new Error(
        "scheduleSms: no from-number configured; pass fromNumber or set a default sender id first",
      );
    }
    resolvedFrom = userFrom;
  }

  // ---- Insert message + recipient + scheduled_job rows ----------------

  const insertedMessage = await db.insert("messages", {
    user_id: userId,
    body,
    from_number: resolvedFrom,
    status: "scheduled",
    cost_credits: 1,
    scheduled_for: runAtDate,
  });
  const messageId = insertedMessage.id as number;

  const insertedRecipient = await db.insert("message_recipients", {
    message_id: messageId,
    contact_id:
      contactRows.length > 0 ? (contactRows[0]!.id as number) : null,
    phone: normalizedTo,
    status: "pending",
  });
  // We don't return recipientId (the processor picks it up by message_id),
  // but keeping the insert here matches sendSmsAction and ensures the
  // scheduled_jobs processor can dispatch without an extra lookup.
  void insertedRecipient;

  const insertedJob = await db.insert("scheduled_jobs", {
    user_id: userId,
    message_id: messageId,
    run_at: runAtDate,
    status: "pending",
    attempts: 0,
  });
  const jobId = insertedJob.id as number;

  return { messageId, jobId };
}

// ============================================================================
// Cancel internal
// ============================================================================

export interface CancelScheduledInput {
  userId: number;
  messageId: number;
  db: TestDb;
}

/**
 * Flip a `messages` row + matching `scheduled_jobs` row to `cancelled`.
 *
 * The matching `scheduled_jobs` row is found by `message_id`; there's a
 * 1:1 relationship per message today. If the message is not in
 * `scheduled` status, this is a no-op (we treat re-cancelling a sent or
 * already-cancelled row as an error so the caller doesn't accidentally
 * "cancel" a delivered message and confuse their UI).
 */
export async function __cancelScheduledInternal(
  input: CancelScheduledInput,
): Promise<{ messageId: number; jobId: number }> {
  const { userId, messageId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("cancelScheduled: userId must be a positive integer");
  }
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("cancelScheduled: messageId must be a positive integer");
  }

  // ---- Look up the message (and scope-check ownership) ------------------

  const messageRows = await db.select("messages", { id: messageId });
  if (messageRows.length === 0) {
    throw new Error(
      `cancelScheduled: message ${messageId} not found`,
    );
  }
  const messageRow = messageRows[0]!;
  if (messageRow.user_id !== userId) {
    // Use the same "not found" message we use for missing rows so we
    // don't leak row existence across users.
    throw new Error(
      `cancelScheduled: message ${messageId} not found`,
    );
  }
  if (messageRow.status !== "scheduled") {
    throw new Error(
      `cancelScheduled: message ${messageId} is not cancellable (status=${String(
        messageRow.status,
      )}); only messages in 'scheduled' status can be cancelled`,
    );
  }

  // ---- Look up the matching scheduled job ------------------------------

  const jobRows = await db.select("scheduled_jobs", { message_id: messageId });
  if (jobRows.length === 0) {
    throw new Error(
      `cancelScheduled: no scheduled_jobs row found for message ${messageId}`,
    );
  }
  const jobRow = jobRows[0]!;
  if (jobRow.status !== "pending") {
    throw new Error(
      `cancelScheduled: scheduled_jobs row ${jobRow.id} is not pending (status=${String(
        jobRow.status,
      )})`,
    );
  }

  // ---- Flip both rows to 'cancelled' -----------------------------------

  await db.update(
    "messages",
    { id: messageId },
    { status: "cancelled" },
  );
  await db.update(
    "scheduled_jobs",
    { id: jobRow.id as number },
    { status: "cancelled" },
  );

  return { messageId, jobId: jobRow.id as number };
}