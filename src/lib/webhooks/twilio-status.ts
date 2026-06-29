/**
 * Twilio status-callback handler (US-012).
 *
 * Twilio POSTs `application/x-www-form-urlencoded` payloads to a
 * configured status callback URL whenever an outbound message
 * transitions through its lifecycle:
 *
 *   queued → sending → sent → delivered
 *                          ↘ failed / undelivered
 *
 * We accept the form data, normalize the (MessageSid, MessageStatus)
 * pair into an idempotency key, and stamp the corresponding
 * `messages` + `message_recipients` rows.
 *
 * Idempotency: every accepted event inserts a row into
 * `webhook_events` with `source='twilio'` and a deterministic
 * `event_id = "${MessageSid}:${MessageStatus}"`. A second delivery
 * of the SAME event matches the existing row and is treated as a
 * no-op duplicate (returns 200, no second update).
 *
 * Lookup order:
 *   1. `messages.twilio_message_sid` (single-send path — US-009)
 *   2. `message_recipients.twilio_message_sid` (bulk-send path — US-010)
 *
 * If neither matches, we still acknowledge the event (200) so Twilio
 * stops retrying; we just don't update anything. A `webhook_events`
 * row is recorded either way so a real provider's retry storm
 * doesn't translate into an audit-log gap.
 *
 * Why a separate lib (not in the route handler): the route handler
 * is a thin shell that does form parsing + status mapping. Putting
 * the actual lookup / update / idempotency logic in a plain async
 * function lets us unit-test it with a fresh `createTestDb()` and
 * no `Request` / `next/headers` plumbing.
 */

import type { TestDb, TestRow } from "@/test/db";

// ============================================================================
// Types
// ============================================================================

/**
 * The Twilio status values we recognize. Twilio's docs list
 * more (`accepted`, `receiving`, `received`, `scheduled`,
 * `read`, ...) but the ones below cover the lifecycle we care
 * about; anything else is mapped to `'pending'` (no terminal
 * state) so a webhook we don't fully understand doesn't crash
 * the handler.
 *
 * Reference: https://www.twilio.com/docs/messaging/services/api/messaging-status-callback
 */
export type TwilioMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "delivered"
  | "undelivered"
  | "accepted"
  | "receiving"
  | "received"
  | "scheduled"
  | "read"
  | "canceled"
  | "unknown";

/**
 * The status values we actually write into the DB. The DB enums are
 * the source of truth — see `messageStatusEnum` + `recipientStatusEnum`
 * in `src/db/schema.ts`.
 */
export type MappedMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "pending"
  | "received";

export interface ProcessTwilioStatusInput {
  /** The Twilio MessageSid. Required — missing values are 400'd at the route layer. */
  messageSid: string;
  /** The Twilio MessageStatus (raw string from the form). */
  messageStatus: string;
  /** Optional Twilio error code (e.g. "30007" for filtered content). */
  errorCode?: string;
  /** The DB to read/write. */
  db: TestDb;
  /**
   * The "now" used to stamp `delivered_at` / `sent_at`. Tests pin
   * this; production calls pass `new Date()`.
   */
  now: Date;
}

export type ProcessTwilioStatusOutcome =
  /** A new `messages` row was updated with this event. */
  | {
      result: "updated_message";
      eventId: string;
      messageId: number;
      mappedStatus: MappedMessageStatus;
    }
  /** A `message_recipients` row was updated and its parent message was too. */
  | {
      result: "updated_recipient";
      eventId: string;
      messageId: number;
      recipientId: number;
      mappedStatus: MappedMessageStatus;
    }
  /**
   * The (MessageSid, MessageStatus) pair was already seen — this is a
   * retry. We record nothing and update nothing. The route layer
   * still returns 200.
   */
  | { result: "duplicate"; eventId: string }
  /**
   * The MessageSid didn't match any message or recipient we know
   * about. We still record the event in `webhook_events` so the
   * audit log is complete, and we return 200 so Twilio stops
   * retrying.
   */
  | {
      result: "unknown";
      eventId: string;
    };

// ============================================================================
// Status mapping
// ============================================================================

/**
 * Map a raw Twilio `MessageStatus` string to the closest value in
 * our DB enums. Falls back to `'pending'` for values we don't
 * recognize so the handler stays a no-op for unknown states
 * rather than crashing.
 */
export function mapMessageStatusToEnum(
  raw: string,
): MappedMessageStatus {
  switch (raw) {
    case "delivered":
      return "delivered";
    case "sent":
    case "sending":
      return "sent";
    case "failed":
    case "undelivered":
    case "canceled":
      return "failed";
    case "received":
    case "read":
      return "received";
    case "queued":
    case "accepted":
    case "scheduled":
    case "receiving":
    case "unknown":
    default:
      return "pending";
  }
}

/**
 * Build the idempotency key. Format: `"${MessageSid}:${MessageStatus}"`.
 * Twilio is allowed to send the same (sid, status) pair more than
 * once (network retries, etc.), so the key deliberately includes
 * the status — a transition from `sent` to `delivered` should land
 * as a second distinct event.
 */
export function buildEventId(messageSid: string, messageStatus: string): string {
  return `${messageSid}:${messageStatus}`;
}

// ============================================================================
// Core handler
// ============================================================================

/**
 * Apply a Twilio status-callback event to the local DB.
 *
 * Steps:
 *   1. Compute `eventId = ${MessageSid}:${MessageStatus}`.
 *   2. Pre-check `webhook_events` for a matching `(source, event_id)`
 *      row. If found, return `{ result: 'duplicate' }` and stop —
 *      the previous delivery already wrote the updates.
 *   3. Otherwise insert a fresh `webhook_events` row. (Best-effort:
 *      the shim doesn't enforce the unique index, so a real Postgres
 *      race would also backstop this in production.)
 *   4. Map the raw status to the DB enum and look up the matching
 *      `messages` / `message_recipients` row.
 *   5. Stamp `status`, the appropriate time column, and (if provided)
 *      the Twilio `error_code` on the matching rows.
 *   6. Return an outcome the route handler can map to an HTTP status.
 */
export async function processTwilioStatus(
  input: ProcessTwilioStatusInput,
): Promise<ProcessTwilioStatusOutcome> {
  const { messageSid, messageStatus, errorCode, db, now } = input;
  const eventId = buildEventId(messageSid, messageStatus);
  const mappedStatus = mapMessageStatusToEnum(messageStatus);

  // ---- Idempotency check ------------------------------------------------

  const existing = await db.select("webhook_events", {
    source: "twilio",
    event_id: eventId,
  });
  if (existing.length > 0) {
    return { result: "duplicate", eventId };
  }

  // Always record the event, even if we can't find a matching message
  // — this gives us a full audit log of what Twilio sent us.
  await db.insert("webhook_events", {
    source: "twilio",
    event_id: eventId,
    payload: {
      message_sid: messageSid,
      message_status: messageStatus,
      error_code: errorCode ?? null,
    },
  });

  // ---- Look up the target rows -----------------------------------------

  // First try the parent message (single-send path).
  const messageMatches = await db.select("messages", {
    twilio_message_sid: messageSid,
  });
  if (messageMatches.length > 0) {
    const messageId = messageMatches[0]!.id as number;
    const update: Record<string, unknown> = { status: mappedStatus };
    if (mappedStatus === "delivered") {
      update.delivered_at = now;
    } else if (mappedStatus === "sent") {
      update.sent_at = now;
    }
    if (errorCode && errorCode.length > 0) {
      update.error_code = errorCode;
    }
    await db.update("messages", { id: messageId }, update);
    return { result: "updated_message", eventId, messageId, mappedStatus };
  }

  // Then the recipient (bulk-send path — one providerMessageId per row).
  const recipientMatches = await db.select("message_recipients", {
    twilio_message_sid: messageSid,
  });
  if (recipientMatches.length > 0) {
    const recipient = recipientMatches[0]!;
    const recipientId = recipient.id as number;
    const messageId = recipient.message_id as number;

    const recipientUpdate: Record<string, unknown> = { status: mappedStatus };
    if (mappedStatus === "delivered") {
      recipientUpdate.delivered_at = now;
    } else if (mappedStatus === "sent") {
      recipientUpdate.sent_at = now;
    }
    if (errorCode && errorCode.length > 0) {
      recipientUpdate.error_code = errorCode;
    }
    await db.update("message_recipients", { id: recipientId }, recipientUpdate);

    // Also update the parent message status. Use the most advanced
    // status across the parent's own row + any recipient. A simple
    // approach: if the parent has no `sent_at` and this recipient
    // is `sent`/`delivered`, stamp it. If the parent has no
    // `delivered_at` and this recipient is `delivered`, stamp it.
    const parentRows = await db.select("messages", { id: messageId });
    const parent = parentRows[0] as TestRow | undefined;
    if (parent) {
      const messageUpdate: Record<string, unknown> = { status: mappedStatus };
      if (mappedStatus === "delivered" && parent.delivered_at == null) {
        messageUpdate.delivered_at = now;
      }
      if (mappedStatus === "sent" && parent.sent_at == null) {
        messageUpdate.sent_at = now;
      }
      if (errorCode && errorCode.length > 0 && parent.error_code == null) {
        messageUpdate.error_code = errorCode;
      }
      await db.update("messages", { id: messageId }, messageUpdate);
    }

    return {
      result: "updated_recipient",
      eventId,
      messageId,
      recipientId,
      mappedStatus,
    };
  }

  // No matching row — Twilio told us about a message we don't have.
  // Returning `unknown` lets the route layer respond 200 so Twilio
  // stops retrying.
  return { result: "unknown", eventId };
}
