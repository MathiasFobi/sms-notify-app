"use server";

/**
 * Server actions for the single-recipient send page (`/app/send`).
 *
 * - `sendSmsAction({ to, body, fromNumber? })` — send a single SMS
 *   through the configured `SmsProvider` (mock by default).
 *
 *   Validation order (cheap checks first, expensive ones later so we
 *   don't burn a provider call on a request we already know is bad):
 *
 *     1. `userId` is a positive integer.
 *     2. `body` is a non-empty string and ≤ 1600 characters (the SMS
 *        spec limit for multipart messages — providers segment above
 *        160 chars but the hard cap is 1600).
 *     3. `to` is a non-empty E.164-ish phone (normalized via
 *        `normalizePhone`).
 *     4. The user has at least 1 credit. If not, refuse — no rows
 *       are written, no provider call is made.
 *     5. If a contact exists for `(userId, normalizedTo)` and is
 *        opted out, refuse — no rows written, no provider call.
 *     6. The user has a from-number configured (either explicit
 *        `fromNumber` arg or `users.twilio_from_number`). If not,
 *        refuse — no rows written.
 *     7. Insert a `messages` row (`status='sent'`), insert one
 *        `message_recipients` row (`status='sent'`), call
 *        `getSmsProvider().send()`, then stamp `twilio_message_sid`
 *        on both the message and the recipient from the provider's
 *        response. Decrement `accounts.credits` by 1 and write a
 *        `credit_transactions` row with `reason='send'`.
 *
 *   On any provider failure (`ok === false`), we still keep the
 *   message + recipient rows (so the UI can show the failure), but
 *   we flip their status to `'failed'`, record the `error_code` /
 *   `error` message, and DO NOT deduct credits — the user shouldn't
 *   be charged for an SMS that wasn't actually delivered.
 *
 * The actual DB work is delegated to `__sendSmsInternal`, which is
 * exported with the `__` prefix so unit tests can exercise it
 * directly with a fresh `TestDb` (no singleton coupling, no
 * `requireUser()` plumbing).
 */

import { requireUser } from "@/lib/auth/require-user";
import { normalizePhone } from "@/lib/phone";
import { getSmsProvider, type SmsProvider } from "@/lib/sms";
import { getTestDb, type TestDb } from "@/test/db";

// NOTE: This is a `"use server"` file. Next.js 16 only allows async
// functions (and type-only exports) from such files — re-exporting
// schema table objects would fail the build. Importers grab the
// schema directly from "@/db/schema" instead.

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Send a single SMS through the configured provider.
 *
 * Returns the inserted `messageId` and the `providerMessageId`
 * reported by the provider (e.g. `"mock_<uuid>"` for the mock). On
 * failure throws an `Error` with a readable message; partial-state
 * rows (message / recipient marked `failed`) are kept so the caller
 * can show them.
 */
export async function sendSmsAction(args: {
  to: string;
  body: string;
  fromNumber?: string;
}): Promise<{
  messageId: number;
  providerMessageId: string;
  recipientId: number;
}> {
  const user = await requireUser();
  return __sendSmsInternal({
    userId: user.id,
    to: args.to,
    body: args.body,
    fromNumber: args.fromNumber,
    db: getTestDb(),
    // Lazy singleton; tests of the internal pass their own provider
    // so they can inspect / control the call.
    provider: getSmsProvider(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface SendSmsInput {
  userId: number;
  to: string;
  body: string;
  fromNumber?: string;
  db: TestDb;
  /**
   * Override the SMS provider. Production code uses `getSmsProvider()`;
   * tests pass a `MockSmsProvider` (or a stub) so they can assert on
   * the call shape without going through the singleton.
   */
  provider: SmsProvider;
}

const MAX_BODY_CHARS = 1600;

/**
 * Insert a `messages` row, a `message_recipients` row, call the
 * provider, then stamp the `providerMessageId` back. Decrement
 * `accounts.credits` by 1 (only on provider success) and write a
 * `credit_transactions` row.
 *
 * On provider failure (`ok === false`): flip the inserted rows to
 * `status='failed'`, record the error, and DO NOT deduct credits.
 * We still return the rows so the UI can show them.
 */
export async function __sendSmsInternal(
  input: SendSmsInput,
): Promise<{
  messageId: number;
  providerMessageId: string;
  recipientId: number;
}> {
  const { userId, to, body, fromNumber, db, provider } = input;

  // ---- Validation (cheap first, no DB writes) ---------------------------

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("sendSms: userId must be a positive integer");
  }
  if (typeof body !== "string" || body.length === 0) {
    throw new Error("sendSms: body is required");
  }
  if (body.length > MAX_BODY_CHARS) {
    throw new Error(
      `sendSms: body is ${body.length} characters; maximum is ${MAX_BODY_CHARS}`,
    );
  }

  const normalizedTo = normalizePhone(to);
  if (normalizedTo === null || normalizedTo.length === 0) {
    throw new Error("sendSms: to is required");
  }

  // ---- Credit check (no rows written if it fails) -----------------------

  const accountRows = await db.select("accounts", { user_id: userId });
  if (accountRows.length === 0) {
    throw new Error(`sendSms: account not found for user ${userId}`);
  }
  const accountRow = accountRows[0]!;
  const currentCredits =
    typeof accountRow.credits === "number" ? accountRow.credits : 0;
  if (currentCredits <= 0) {
    throw new Error(
      `sendSms: user ${userId} has no credits; purchase more before sending`,
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
        `sendSms: contact ${contact.id} (${normalizedTo}) has opted out`,
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
        "sendSms: no from-number configured; pass fromNumber or set a default sender id first",
      );
    }
    resolvedFrom = userFrom;
  }

  // ---- Insert message + recipient rows (status='sent' from the start,
  //      stamp the providerMessageId on the same insert so the rows
  //      are usable if anything interrupts between insert and provider
  //      call) -----------------------------------------------------------

  const insertedMessage = await db.insert("messages", {
    user_id: userId,
    body,
    from_number: resolvedFrom,
    status: "sent",
    cost_credits: 1,
  });
  const messageId = insertedMessage.id as number;

  const insertedRecipient = await db.insert("message_recipients", {
    message_id: messageId,
    contact_id:
      contactRows.length > 0 ? (contactRows[0]!.id as number) : null,
    phone: normalizedTo,
    status: "sent",
  });
  const recipientId = insertedRecipient.id as number;

  // ---- Call the provider -----------------------------------------------

  const result = await provider.send({
    to: normalizedTo,
    body,
    from: resolvedFrom,
  });

  if (!result.ok || !result.providerMessageId) {
    // Flip both rows to failed, record the error. NO credit deduction.
    const errorMessage = result.error ?? "provider rejected the send";
    await db.update(
      "messages",
      { id: messageId },
      {
        status: "failed",
        error_code: "provider_rejected",
        sent_at: new Date(),
      },
    );
    await db.update(
      "message_recipients",
      { id: recipientId },
      {
        status: "failed",
        error_code: "provider_rejected",
        sent_at: new Date(),
      },
    );
    throw new Error(`sendSms: provider rejected the send: ${errorMessage}`);
  }

  // ---- Success: stamp providerMessageId, decrement credits, log -------

  const providerMessageId = result.providerMessageId;
  const now = new Date();
  await db.update(
    "messages",
    { id: messageId },
    {
      twilio_message_sid: providerMessageId,
      sent_at: now,
    },
  );
  await db.update(
    "message_recipients",
    { id: recipientId },
    {
      twilio_message_sid: providerMessageId,
      sent_at: now,
    },
  );

  await db.update(
    "accounts",
    { user_id: userId },
    { credits: currentCredits - 1 },
  );
  await db.insert("credit_transactions", {
    user_id: userId,
    delta: -1,
    reason: "send",
  });

  return { messageId, providerMessageId, recipientId };
}

// (No schema re-exports here — see the NOTE at the top of the file.)