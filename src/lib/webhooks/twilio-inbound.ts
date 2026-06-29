/**
 * Twilio inbound-message handler (US-013).
 *
 * Twilio POSTs `application/x-www-form-urlencoded` payloads to a
 * configured messaging webhook whenever a recipient REPLIES to one
 * of our outbound messages. The payload shape is the same as the
 * status callback — Twilio just calls it on a different URL:
 *
 *   From=+15551234567         (the contact that replied)
 *   To=+15550000000           (our number — used to look up the user)
 *   Body=STOP                 (the reply text)
 *   MessageSid=SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *
 * What we do:
 *
 *   1. Resolve the user who owns `To`. We try two paths:
 *      a. `users.twilio_from_number === To` — the user's primary
 *         sending number.
 *      b. `sender_ids.value === To AND sender_ids.status === 'approved'`
 *         — a separate sender ID the user has registered with
 *         Twilio (alphanumeric or dedicated).
 *      If neither matches, the message is logged as `unknown_to` —
 *      we still 200 so Twilio stops retrying.
 *
 *   2. Insert an `inbound_messages` row scoped to that user. The
 *      `(twilio_message_sid)` unique index provides production-grade
 *      idempotency; the helper also pre-checks via the shim's
 *      `select()` because the in-memory shim doesn't enforce unique
 *      indexes. A replay of the same MessageSid returns
 *      `{ result: 'duplicate' }` and writes nothing new.
 *
 *   3. If `Body.trim().toUpperCase()` is one of the standard opt-out
 *      keywords (`STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`),
 *      flip `opted_out = true` on any contact owned by the resolved
 *      user whose `phone` (after best-effort E.164 normalization)
 *      matches the inbound `From`. This is how Twilio-mandated
 *      opt-out semantics reach our DB.
 *
 *   4. Missing-field errors are 400'd at the route layer; the helper
 *      assumes its inputs are already validated.
 *
 * Why a separate lib (not in the route handler): the route handler
 * is a thin shell that does form parsing + status mapping. Putting
 * the actual lookup / insert / STOP-handling logic in a plain async
 * function lets us unit-test it with a fresh `createTestDb()` and
 * no `Request` / `next/headers` plumbing.
 */

import type { TestDb } from "@/test/db";
import { normalizePhone } from "@/lib/phone";

// ============================================================================
// Types
// ============================================================================

/**
 * The opt-out keywords we recognize (case-insensitive after trim+upper).
 * This list mirrors the standard set Twilio recommends customers handle.
 *
 * Reference: https://www.twilio.com/docs/messaging/compliance/opt-out-keywords
 */
export const OPT_OUT_KEYWORDS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
] as const;

/** A single opt-out keyword (literal union, derived from the array above). */
export type OptOutKeyword = (typeof OPT_OUT_KEYWORDS)[number];

export interface ProcessTwilioInboundInput {
  /** The contact's phone number (Twilio's `From` field). */
  from: string;
  /** Our number (Twilio's `To` field). Used to resolve the user. */
  to: string;
  /** The reply text (Twilio's `Body` field). */
  body: string;
  /** The Twilio MessageSid. Required — missing values are 400'd at the route layer. */
  messageSid: string;
  /** The DB to read/write. */
  db: TestDb;
  /**
   * The "now" used to stamp `inbound_messages.received_at`. Tests
   * pin this; production calls pass `new Date()`.
   */
  now: Date;
}

export type ProcessTwilioInboundOutcome =
  /** A new `inbound_messages` row was inserted. */
  | {
      result: "inserted";
      inboundMessageId: number;
      userId: number;
      messageSid: string;
      /** Set when the body was an opt-out keyword — the contact row was updated. */
      optOutApplied: boolean;
      /** The keyword that triggered the opt-out (uppercased). Undefined otherwise. */
      optOutKeyword?: OptOutKeyword;
    }
  /**
   * The (messageSid) pair was already seen — this is a retry. We
   * record nothing and update nothing. The route layer still
   * returns 200.
   */
  | { result: "duplicate"; messageSid: string }
  /**
   * `To` didn't resolve to any user (no matching `twilio_from_number`
   * and no matching approved `sender_ids` row). We return 200 so
   * Twilio stops retrying — orphan inbound messages are not the
   * webhook handler's problem to surface to the caller.
   */
  | { result: "unknown_to"; messageSid: string; to: string };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return true if `body` (after trim + uppercase) is one of the
 * standard opt-out keywords.
 *
 * Exposed for tests + so the route layer can avoid duplicating
 * the keyword list if it ever wants to log "opted-out" separately.
 */
export function isOptOutKeyword(body: string): boolean {
  const normalized = body.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.includes(normalized as OptOutKeyword);
}

/**
 * Return the matched opt-out keyword in canonical form
 * (`"STOP"` / `"STOPALL"` / etc.), or `null` if `body` is not
 * an opt-out. This is what we store on the outcome so callers
 * (analytics, audit logs) know exactly which keyword matched.
 */
export function matchOptOutKeyword(body: string): OptOutKeyword | null {
  const normalized = body.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.includes(normalized as OptOutKeyword)
    ? (normalized as OptOutKeyword)
    : null;
}

// ============================================================================
// User resolution
// ============================================================================

/**
 * Find the user that owns the given `To` number.
 *
 * Lookup order (first match wins):
 *   1. `users.twilio_from_number === to`
 *   2. `sender_ids.value === to AND sender_ids.status === 'approved'`
 *
 * Returns the matching `user_id`, or `null` if nothing matched.
 */
async function resolveUserForToNumber(
  db: TestDb,
  to: string,
): Promise<number | null> {
  const userMatches = await db.select("users", { twilio_from_number: to });
  if (userMatches.length > 0) {
    return userMatches[0]!.id as number;
  }

  const senderIdMatches = await db.select("sender_ids", {
    value: to,
    status: "approved",
  });
  if (senderIdMatches.length > 0) {
    return senderIdMatches[0]!.user_id as number;
  }

  return null;
}

/**
 * Find an existing contact owned by `userId` whose `phone` matches
 * `from` after best-effort E.164 normalization. Returns the contact
 * row, or `null` if there's no match (or `from` is unparseable).
 */
async function findContactByPhone(
  db: TestDb,
  userId: number,
  from: string,
): Promise<{ id: number; optedOut: boolean } | null> {
  let normalized: string;
  try {
    normalized = normalizePhone(from) ?? "";
  } catch {
    return null;
  }
  if (!normalized) return null;

  const matches = await db.select("contacts", {
    user_id: userId,
    phone: normalized,
  });
  if (matches.length === 0) return null;
  const row = matches[0]!;
  return {
    id: row.id as number,
    optedOut: Boolean(row.opted_out),
  };
}

// ============================================================================
// Core handler
// ============================================================================

/**
 * Apply a Twilio inbound-message webhook to the local DB.
 *
 * Steps:
 *   1. Idempotency pre-check on `inbound_messages.twilio_message_sid`.
 *      If the row already exists, return `{ result: 'duplicate' }`
 *      without writing anything else. The in-memory shim doesn't
 *      enforce the unique index — production Postgres will
 *      backstop this with a constraint violation, which we
 *      currently swallow by short-circuiting here.
 *   2. Resolve the user from `to` (twilio_from_number, then approved
 *      sender_ids). If no match, return `{ result: 'unknown_to' }`.
 *   3. Insert the `inbound_messages` row scoped to that user.
 *   4. If `body` is an opt-out keyword, look up the matching
 *      contact by `from` (normalized). If a contact matches and is
 *      not already opted out, flip `opted_out = true`.
 *
 * Note: the inbound row is ALWAYS inserted when we have a known
 * user — even if no contact matches the From number. Replies from
 * people who aren't in our contacts (cold replies, wrong-number
 * messages, etc.) are still useful to surface in the inbox.
 */
export async function processTwilioInbound(
  input: ProcessTwilioInboundInput,
): Promise<ProcessTwilioInboundOutcome> {
  const { from, to, body, messageSid, db, now } = input;

  // ---- Idempotency pre-check ------------------------------------------

  const existing = await db.select("inbound_messages", {
    twilio_message_sid: messageSid,
  });
  if (existing.length > 0) {
    return { result: "duplicate", messageSid };
  }

  // ---- User resolution -------------------------------------------------

  const userId = await resolveUserForToNumber(db, to);
  if (userId === null) {
    return { result: "unknown_to", messageSid, to };
  }

  // ---- Insert the inbound row -----------------------------------------

  const inserted = await db.insert("inbound_messages", {
    user_id: userId,
    from_phone: from,
    to_number: to,
    body,
    twilio_message_sid: messageSid,
    received_at: now,
  });
  const inboundMessageId = inserted.id as number;

  // ---- STOP keyword handling ------------------------------------------

  let optOutApplied = false;
  let optOutKeyword: OptOutKeyword | undefined;

  const matched = matchOptOutKeyword(body);
  if (matched !== null) {
    optOutKeyword = matched;
    const contact = await findContactByPhone(db, userId, from);
    if (contact !== null && !contact.optedOut) {
      await db.update(
        "contacts",
        { id: contact.id },
        { opted_out: true },
      );
      optOutApplied = true;
    }
    // No matching contact → we still logged the inbound; we just
    // don't have a contact row to flip. That's fine — the next
    // bulk-send / single-send will skip the phone via the
    // explicit-opt-out check that compares against the From
    // (rather than the contacts table) on the send path. For
    // the scope of US-013, just no-op.
  }

  const outcome: ProcessTwilioInboundOutcome = {
    result: "inserted",
    inboundMessageId,
    userId,
    messageSid,
    optOutApplied,
  };
  if (optOutKeyword !== undefined) {
    outcome.optOutKeyword = optOutKeyword;
  }
  return outcome;
}