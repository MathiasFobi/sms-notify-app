"use server";

/**
 * Server actions for the Sender IDs page (`/app/sender-ids`).
 *
 * - `requestSenderIdAction({ value })` — register a new sender ID for
 *   the current user. Stored as `status='pending'` until an admin (or
 *   the upstream Twilio mock) flips it to `'approved'` in a later story.
 *   Unique per (userId, value); a duplicate insert is rejected.
 *
 * - `setDefaultSenderIdAction({ id })` — promote an already-approved
 *   sender ID to the user's default `twilio_from_number`. Throws if
 *   the row doesn't belong to the current user, or if its status isn't
 *   `'approved'`. The "belongs to another user" branch returns the
 *   same error shape as "not found" so we don't leak row existence
 *   across users.
 *
 * The actual DB work is delegated to `__requestSenderIdInternal` /
 * `__setDefaultSenderIdInternal`, which are exported with the `__`
 * prefix so unit tests can exercise them directly with a `TestDb`
 * without going through Next.js's server-action plumbing or the
 * `requireUser()` cookie seam.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getTestDb, type TestDb } from "@/test/db";

// NOTE: This is a `"use server"` file. Next.js 16 only allows async
// functions (and type-only exports) from such files — re-exporting
// schema table objects would fail the build if a downstream module
// statically pulled those references in. Importers grab the schema
// directly from "@/db/schema" instead.

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Request a new sender ID for the current user. Inserts a
 * `sender_ids` row with `status='pending'`.
 */
export async function requestSenderIdAction(args: { value: string }): Promise<{
  id: number;
}> {
  const user = await requireUser();
  return __requestSenderIdInternal({
    userId: user.id,
    value: args.value,
    db: getTestDb(),
  });
}

/**
 * Set the current user's default `twilioFromNumber` to the value of
 * an approved sender ID that they own. Throws if the row is missing,
 * belongs to another user, or isn't `'approved'`.
 */
export async function setDefaultSenderIdAction(args: { id: number }): Promise<{
  twilioFromNumber: string;
}> {
  const user = await requireUser();
  return __setDefaultSenderIdInternal({
    userId: user.id,
    senderIdRowId: args.id,
    db: getTestDb(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface RequestSenderIdInput {
  userId: number;
  value: string;
  db: TestDb;
}

/**
 * Insert a `sender_ids` row scoped to `userId`. Validates the value,
 * then writes a row with `status='pending'`. Returns the assigned id.
 *
 * Throws on:
 *   - non-positive userId
 *   - empty / whitespace-only value
 *   - duplicate (userId, value) — the table has a unique index on it
 */
export async function __requestSenderIdInternal(
  input: RequestSenderIdInput,
): Promise<{ id: number }> {
  const { userId, value, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("requestSenderId: userId must be a positive integer");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("requestSenderId: value is required");
  }

  const trimmed = value.trim();

  // Pre-check uniqueness against the in-memory shim so we surface a
  // readable error rather than relying on the unique-index rejection
  // (which is also enforced at the schema level via
  // `sender_ids_user_value_idx`). Real Postgres would reject this
  // with a unique-violation error; the shim doesn't, so we do it
  // explicitly here.
  const existing = await db.select("sender_ids", {
    user_id: userId,
    value: trimmed,
  });
  if (existing.length > 0) {
    throw new Error(
      `requestSenderId: sender id "${trimmed}" already exists for this user`,
    );
  }

  const inserted = await db.insert("sender_ids", {
    user_id: userId,
    value: trimmed,
    status: "pending",
  });
  return { id: inserted.id as number };
}

export interface SetDefaultSenderIdInput {
  userId: number;
  senderIdRowId: number;
  db: TestDb;
}

/**
 * Look up `senderIdRowId` scoped to `userId`, verify `status='approved'`,
 * then write `users.twilioFromNumber = <sender_id.value>` for `userId`.
 *
 * Throws on:
 *   - row not found OR belongs to another user (same error, no leak)
 *   - row status is not `'approved'`
 *   - non-positive inputs
 */
export async function __setDefaultSenderIdInternal(
  input: SetDefaultSenderIdInput,
): Promise<{ twilioFromNumber: string }> {
  const { userId, senderIdRowId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      "setDefaultSenderId: userId must be a positive integer",
    );
  }
  if (!Number.isInteger(senderIdRowId) || senderIdRowId <= 0) {
    throw new Error(
      "setDefaultSenderId: senderIdRowId must be a positive integer",
    );
  }

  const rows = await db.select("sender_ids", {
    id: senderIdRowId,
    user_id: userId,
  });
  if (rows.length === 0) {
    // Use a single error message whether the row doesn't exist or
    // belongs to another user — we don't want to leak existence.
    throw new Error(
      `setDefaultSenderId: sender id ${senderIdRowId} not found for user ${userId}`,
    );
  }

  const row = rows[0]!;
  const status = row.status;
  if (status !== "approved") {
    throw new Error(
      `setDefaultSenderId: sender id ${senderIdRowId} is not approved (status: ${String(status)})`,
    );
  }

  const value = row.value;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `setDefaultSenderId: sender id ${senderIdRowId} has empty value`,
    );
  }

  await db.update("users", { id: userId }, { twilio_from_number: value });
  return { twilioFromNumber: value };
}

// (No schema re-exports here — see the NOTE at the top of the file.)