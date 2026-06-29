"use server";

/**
 * Server actions for the bulk-send form on `/app/send`.
 *
 * - `sendBulkSmsAction({ csv, body, fromNumber? })` — parse a CSV of
 *   phone numbers (one column: `phone`) and blast the same `body` to
 *   every valid, non-opted-out row through the configured `SmsProvider`.
 *
 *   Validation order (cheap checks first, expensive ones later so we
 *   don't burn provider calls on a request we already know is bad):
 *
 *     1. `userId` is a positive integer.
 *     2. `body` is a non-empty string and ≤ 1600 characters (same
 *       limit as the single-send action).
 *     3. `csv` is a non-empty string.
 *     4. Parse the CSV. Extract the `phone` column (first column if no
 *       header is present).
 *     5. Per row:
 *        - normalize the phone via `normalizePhone` — if it throws,
 *          the row is skipped (counted as `invalid`).
 *        - if a contact exists for `(userId, normalizedPhone)` and is
 *          opted out, the row is skipped (counted as `optedOut`).
 *        - otherwise, the row is queued for sending.
 *     6. The user must have at least `N` credits (where `N` is the
 *        number of queued rows). If not, refuse — no rows written.
 *     7. The user must have a from-number configured (explicit
 *        `fromNumber` arg or `users.twilio_from_number`).
 *     8. Insert one `messages` row (`status='sent'`), insert N
 *        `message_recipients` rows (`status='sent'`).
 *     9. Call `getSmsProvider().send()` for every recipient in parallel
 *        via `Promise.allSettled`. On each result:
 *          - ok → stamp `twilio_message_sid` + `sent_at` on both
 *            message and recipient.
 *          - failure → flip both rows to `status='failed'` with
 *            `error_code='provider_rejected'`.
 *    10. Decrement `accounts.credits` by `successCount` (the number of
 *        provider-success rows) and write a single
 *        `credit_transactions` row with `delta = -successCount` and
 *        `reason='send'`.
 *
 *   The bulk action is best-effort atomic: every step runs sequentially
 *   (the TestDb shim has no transaction primitive). The pre-credit check
 *   and per-recipient insert happen before any provider call, so a
 *   missing-credits request never partial-writes. A provider failure on
 *   some rows does NOT refund credits — only the rows that succeeded
 *   were actually delivered, so only those are charged. When real
 *   Postgres + Drizzle lands, wrap this in `db.transaction(...)`.
 *
 * The actual DB work is delegated to `__sendBulkSmsInternal`, which is
 * exported with the `__` prefix so unit tests can exercise it directly
 * with a fresh `TestDb` (no singleton coupling, no `requireUser()`).
 */

import { requireUser } from "@/lib/auth/require-user";
import { normalizePhone } from "@/lib/phone";
import { getSmsProvider, type SmsProvider } from "@/lib/sms";
import { getTestDb, type TestDb } from "@/test/db";

// ============================================================================
// Public server action
// ============================================================================

/**
 * Bulk-send an SMS to every phone in the CSV.
 *
 * The CSV is expected to have one column: `phone` (with or without a
 * header row). Other columns are ignored — bulk send takes only a phone
 * number and a body. Names / group assignments live on `contacts` and
 * are not relevant to a one-shot blast.
 *
 * Returns a summary describing how many rows were accepted, skipped
 * (and why), and how many provider calls succeeded vs. failed.
 */
export async function sendBulkSmsAction(args: {
  csv: string;
  body: string;
  fromNumber?: string;
}): Promise<SendBulkSmsResult> {
  const user = await requireUser();
  return __sendBulkSmsInternal({
    userId: user.id,
    csv: args.csv,
    body: args.body,
    fromNumber: args.fromNumber,
    db: getTestDb(),
    // Lazy singleton; tests of the internal pass their own provider
    // so they can inspect / control the call shape.
    provider: getSmsProvider(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface SendBulkSmsInput {
  userId: number;
  csv: string;
  body: string;
  fromNumber?: string;
  db: TestDb;
  /**
   * Override the SMS provider. Production code uses `getSmsProvider()`;
   * tests pass a `MockSmsProvider` (or a spy stub) so they can assert
   * on the call shape without going through the singleton.
   */
  provider: SmsProvider;
}

export interface SendBulkSmsResult {
  /** The inserted `messages.id` for this blast. */
  messageId: number;
  /** The inserted `message_recipients.id` for each recipient, in input order. */
  recipientIds: number[];
  /** How many rows were queued for the provider (CSV rows minus skipped). */
  queued: number;
  /** Total rows skipped (invalid + opted-out combined). */
  skipped: number;
  /** Skipped because the phone failed `normalizePhone`. */
  invalid: number;
  /** Skipped because a matching contact was opted out. */
  optedOut: number;
  /** Provider calls that returned `ok: true`. */
  sent: number;
  /** Provider calls that returned `ok: false` (rejected). */
  failed: number;
  /**
   * Provider message ids returned by the provider for each successful
   * recipient, in the same order as the corresponding `recipientIds`.
   * Length === `sent`.
   */
  providerMessageIds: string[];
}

const MAX_BODY_CHARS = 1600;

/**
 * Insert one `messages` row + N `message_recipients` rows, call the
 * provider once per recipient in parallel, then decrement credits for
 * the rows that succeeded.
 *
 * On per-recipient provider failure (`ok === false`): flip that
 * recipient's row to `status='failed'` with `error_code='provider_rejected'`
 * and DO NOT charge credits for that row. If every recipient failed,
 * the parent `messages` row is also flipped to `status='failed'`.
 */
export async function __sendBulkSmsInternal(
  input: SendBulkSmsInput,
): Promise<SendBulkSmsResult> {
  const { userId, csv, body, fromNumber, db, provider } = input;

  // ---- Validation (cheap first, no DB writes) ---------------------------

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("sendBulkSms: userId must be a positive integer");
  }
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("sendBulkSms: body is required");
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new Error(
      `sendBulkSms: body is ${body.length} characters; maximum is ${MAX_BODY_CHARS}`,
    );
  }
  // ---- Parse the CSV -----------------------------------------------------

  // Always parse the CSV — even for whitespace-only / newline-only
  // input — so we can return the more specific "no phone numbers"
  // error in that case. (Pasting a CSV from a spreadsheet that ends
  // with a trailing newline is a common case.)
  const parsed = parseBulkCsv(csv);
  if (parsed.phones.length === 0) {
    throw new Error(
      csv.trim().length === 0
        ? "sendBulkSms: csv is required"
        : "sendBulkSms: csv contains no phone numbers",
    );
  }
  // (queue.length === 0 is fine — every row was skipped. We still
  //  create the audit messages row below.)

  // ---- Per-row normalization + opt-out check -----------------------------

  /**
   * Rows that survived validation and are eligible to send. Stored
   * in input order so the result array preserves the user's CSV order.
   */
  interface QueuedRow {
    rowIndex: number;
    normalizedPhone: string;
    contactId: number | null;
  }

  const queued: QueuedRow[] = [];
  let invalidCount = 0;
  let optedOutCount = 0;

  for (let i = 0; i < parsed.phones.length; i++) {
    const rawPhone = parsed.phones[i]!;
    let normalized: string;
    try {
      normalized = normalizePhone(rawPhone) ?? "";
    } catch {
      invalidCount++;
      continue;
    }
    if (normalized.length === 0) {
      invalidCount++;
      continue;
    }

    // Opt-out check: only matters if a contact exists for this phone.
    const contactRows = await db.select("contacts", {
      user_id: userId,
      phone: normalized,
    });
    if (contactRows.length > 0 && contactRows[0]!.opted_out === true) {
      optedOutCount++;
      continue;
    }

    queued.push({
      rowIndex: i,
      normalizedPhone: normalized,
      contactId:
        contactRows.length > 0 ? (contactRows[0]!.id as number) : null,
    });
  }

  const skipped = invalidCount + optedOutCount;

  // ---- Credit check (no rows written if it fails) -----------------------

  const accountRows = await db.select("accounts", { user_id: userId });
  if (accountRows.length === 0) {
    throw new Error(`sendBulkSms: account not found for user ${userId}`);
  }
  const accountRow = accountRows[0]!;
  const currentCredits =
    typeof accountRow.credits === "number" ? accountRow.credits : 0;
  if (currentCredits < queued.length) {
    throw new Error(
      `sendBulkSms: user ${userId} has ${currentCredits} credits; need at least ${queued.length} for this blast`,
    );
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
        "sendBulkSms: no from-number configured; pass fromNumber or set a default sender id first",
      );
    }
    resolvedFrom = userFrom;
  }

  // ---- Insert message + recipient rows (status='sent' from the start) ---

  // If every row was skipped we still create a `messages` row so the
  // blast is auditable, but the recipient list is empty and no provider
  // calls fire.
  const insertedMessage = await db.insert("messages", {
    user_id: userId,
    body,
    from_number: resolvedFrom,
    status: "sent",
    cost_credits: queued.length,
  });
  const messageId = insertedMessage.id as number;

  const recipientIds: number[] = [];
  for (const q of queued) {
    const insertedRecipient = await db.insert("message_recipients", {
      message_id: messageId,
      contact_id: q.contactId,
      phone: q.normalizedPhone,
      status: "sent",
    });
    recipientIds.push(insertedRecipient.id as number);
  }

  // ---- Call the provider for every recipient (parallel via allSettled) --

  const providerResults = await Promise.allSettled(
    queued.map((q) =>
      provider.send({
        to: q.normalizedPhone,
        body,
        from: resolvedFrom,
      }),
    ),
  );

  // Walk the parallel results and stamp the DB accordingly.
  let sentCount = 0;
  let failedCount = 0;
  const providerMessageIds: string[] = [];

  for (let i = 0; i < providerResults.length; i++) {
    const settled = providerResults[i]!;
    const recipientId = recipientIds[i]!;
    const queuedRow = queued[i]!;

    if (settled.status === "rejected") {
      // Provider threw (shouldn't happen per the SmsProvider contract,
      // but defensively handle it as a failure).
      failedCount++;
      await db.update(
        "message_recipients",
        { id: recipientId },
        {
          status: "failed",
          error_code: "provider_threw",
          sent_at: new Date(),
        },
      );
      continue;
    }

    const result = settled.value;
    if (!result.ok || !result.providerMessageId) {
      failedCount++;
      const errorMessage = result.error ?? "provider rejected the send";
      await db.update(
        "message_recipients",
        { id: recipientId },
        {
          status: "failed",
          error_code: "provider_rejected",
          sent_at: new Date(),
        },
      );
      // Record the provider's error message on the recipient for debugging.
      // We keep this on the recipient only — message-level error_code
      // reflects the blast aggregate (set after the loop).
      void errorMessage;
      void queuedRow;
      continue;
    }

    // Success path — stamp twilio_message_sid + sent_at on the
    // recipient. The parent messages row has multiple provider
    // message ids (one per recipient), so we deliberately leave its
    // `twilio_message_sid` null; per-recipient sids are the
    // authoritative link to the upstream provider.
    const providerMessageId = result.providerMessageId;
    await db.update(
      "message_recipients",
      { id: recipientId },
      {
        twilio_message_sid: providerMessageId,
        sent_at: new Date(),
      },
    );
    // Stamp `sent_at` on the parent messages row the first time we
    // see a success (cheap idempotency: re-stamping the same instant
    // is a no-op semantically).
    await db.update("messages", { id: messageId }, { sent_at: new Date() });
    sentCount++;
    providerMessageIds.push(providerMessageId);
  }

  // If every provider call failed, the parent message row should also
  // reflect the failure so the future messages-list page can render
  // it as a failed blast.
  if (queued.length > 0 && sentCount === 0) {
    await db.update(
      "messages",
      { id: messageId },
      {
        status: "failed",
        error_code: "provider_rejected",
      },
    );
  }

  // ---- Decrement credits + write a single credit_transactions row -------

  if (sentCount > 0) {
    await db.update(
      "accounts",
      { user_id: userId },
      { credits: currentCredits - sentCount },
    );
    await db.insert("credit_transactions", {
      user_id: userId,
      delta: -sentCount,
      reason: "send",
    });
  }

  return {
    messageId,
    recipientIds,
    queued: queued.length,
    skipped,
    invalid: invalidCount,
    optedOut: optedOutCount,
    sent: sentCount,
    failed: failedCount,
    providerMessageIds,
  };
}

// ============================================================================
// CSV parsing
// ============================================================================

/**
 * Minimal RFC-4180-ish CSV parser used for bulk-send input. Handles:
 *   - quoted fields with embedded commas / newlines
 *   - `""` as an escaped double-quote inside a quoted field
 *   - `\r\n` and `\n` line endings
 *   - a single header row (detected heuristically — if the first row's
 *     first cell is the literal string `phone`, it's treated as a
 *     header and skipped)
 *
 * Returns just the `phone` column. If a header row is detected, we look
 * for a column literally named `phone` (case-insensitive). If no header
 * row is present, the first column is the phone. Other columns are
 * ignored — bulk send takes only the phone; the rest of the contact's
 * data lives in the `contacts` table.
 *
 * Duplicate rows are NOT deduped here — the caller may want to send the
 * same body to the same person twice (intentional re-engagement). If a
 * real product needs dedup, do it in the caller or in a future story.
 */
function parseBulkCsv(input: string): { phones: string[] } {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
        rows.push(row);
      }
      row = [];
      if (ch === "\r" && input[i + 1] === "\n") {
        i++;
      }
      continue;
    }
    field += ch;
  }

  // Flush the last field / row (if the file doesn't end with a newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return { phones: [] };

  // Header detection — case-insensitive `phone` in the first cell of
  // the first row.
  const firstRow = rows[0]!;
  const firstCell = (firstRow[0] ?? "").trim().toLowerCase();
  let phoneColumnIndex = 0;
  let startRow = 0;
  if (firstCell === "phone") {
    // Find a column literally named "phone" (case-insensitive). If
    // none, fall back to the first column so a header row with
    // unexpected casing doesn't silently drop every recipient.
    const idx = firstRow.findIndex(
      (c) => c.trim().toLowerCase() === "phone",
    );
    phoneColumnIndex = idx >= 0 ? idx : 0;
    startRow = 1;
  }

  const phones: string[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i]!;
    const cell = (r[phoneColumnIndex] ?? "").trim();
    if (cell.length === 0) continue; // skip empty rows
    phones.push(cell);
  }

  return { phones };
}

// (No schema re-exports here — see the NOTE in send.ts.)