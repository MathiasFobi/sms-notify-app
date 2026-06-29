"use server";

/**
 * Server actions for the Settings page (`/app/settings`).
 *
 * - `updateProfileAction({ name })` — rewrite the current user's
 *   `users.name` to the new value. Trims surrounding whitespace
 *   and rejects empty inputs. The change applies immediately and
 *   the settings page is revalidated by Next.js on the next render.
 *
 * - `updateDefaultSenderIdAction({ senderId })` — set
 *   `users.twilio_from_number` for the current user. Accepts EITHER
 *   a `senderId` row id (must belong to the current user, must be
 *   `status='approved'`) OR `null` to CLEAR the current default
 *   (sets the column back to `null`).
 *
 *   The "belongs to another user" branch throws the same error as
 *   "not found" / "not approved" — we don't leak row existence
 *   across users.
 *
 * The actual DB work is delegated to `__updateProfileInternal` /
 * `__updateDefaultSenderIdInternal`, which are exported with the
 * `__` prefix so unit tests can exercise them directly with a fresh
 * `TestDb` (no singleton coupling, no `requireUser()` plumbing).
 * Mirrors every other action file in `src/lib/actions/`.
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
 * Update the current user's display name. The value is trimmed
 * before being persisted; an empty / whitespace-only name is
 * rejected and no row is written.
 *
 * Returns `{ name }` on success with the trimmed value that was
 * stored (so the client form can re-sync its display without a
 * re-render round-trip).
 */
export async function updateProfileAction(args: { name: string }): Promise<{
  name: string;
}> {
  const user = await requireUser();
  return __updateProfileInternal({
    userId: user.id,
    name: args.name,
    db: getTestDb(),
  });
}

/**
 * Set (or clear) the current user's default `twilio_from_number`.
 *
 * Pass `{ senderId: null }` to clear the default. Pass
 * `{ senderId: <rowId> }` to promote one of the user's APPROVED
 * sender ID rows to the default.
 *
 * Throws on:
 *   - non-positive `userId`
 *   - sender id belongs to another user (same error as not-found)
 *   - sender id status is not `'approved'`
 *   - sender id has an empty `value` (defensive — should never
 *     happen because the schema requires it, but we sanity-check)
 */
export async function updateDefaultSenderIdAction(args: {
  senderId: number | null;
}): Promise<{ twilioFromNumber: string | null }> {
  const user = await requireUser();
  return __updateDefaultSenderIdInternal({
    userId: user.id,
    senderId: args.senderId,
    db: getTestDb(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface UpdateProfileInput {
  userId: number;
  name: string;
  db: TestDb;
}

/**
 * Rewrite `users.name` for `userId` to the trimmed `name`.
 *
 * Throws on:
 *   - non-positive userId
 *   - non-string `name`
 *   - empty / whitespace-only `name` (after trim)
 *   - user row not found
 */
export async function __updateProfileInternal(
  input: UpdateProfileInput,
): Promise<{ name: string }> {
  const { userId, name, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("updateProfile: userId must be a positive integer");
  }
  if (typeof name !== "string") {
    throw new Error("updateProfile: name must be a string");
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("updateProfile: name is required");
  }

  // Confirm the user actually exists before we issue the update.
  // The in-memory shim's `update` is a silent no-op when the where
  // clause matches nothing, so we pre-check to surface a clear
  // error rather than confusing the caller with a successful return.
  const userRows = await db.select("users", { id: userId });
  if (userRows.length === 0) {
    throw new Error(`updateProfile: user ${userId} not found`);
  }

  await db.update("users", { id: userId }, { name: trimmed });
  return { name: trimmed };
}

export interface UpdateDefaultSenderIdInput {
  userId: number;
  senderId: number | null;
  db: TestDb;
}

/**
 * Set `users.twilio_from_number` for `userId` to the `value` of the
 * sender_id row identified by `senderId`. If `senderId` is `null`,
 * clear the default (set the column to `null`).
 *
 * Throws on:
 *   - non-positive userId
 *   - non-positive senderId (when not null)
 *   - sender id row not found OR belongs to another user (same error)
 *   - sender id status is not `'approved'`
 *   - sender id value is empty (defensive)
 */
export async function __updateDefaultSenderIdInternal(
  input: UpdateDefaultSenderIdInput,
): Promise<{ twilioFromNumber: string | null }> {
  const { userId, senderId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(
      "updateDefaultSenderId: userId must be a positive integer",
    );
  }

  // Null short-circuit — clear the default.
  if (senderId === null) {
    await db.update("users", { id: userId }, { twilio_from_number: null });
    return { twilioFromNumber: null };
  }

  if (!Number.isInteger(senderId) || senderId <= 0) {
    throw new Error(
      "updateDefaultSenderId: senderId must be a positive integer or null",
    );
  }

  // Scope the lookup to the current user so a row that belongs to
  // someone else can't be adopted. Single error message for
  // "missing" vs "wrong user" — don't leak existence.
  const rows = await db.select("sender_ids", {
    id: senderId,
    user_id: userId,
  });
  if (rows.length === 0) {
    throw new Error(
      `updateDefaultSenderId: sender id ${senderId} not found for user ${userId}`,
    );
  }

  const row = rows[0]!;
  const status = row.status;
  if (status !== "approved") {
    throw new Error(
      `updateDefaultSenderId: sender id ${senderId} is not approved (status: ${String(status)})`,
    );
  }

  const value = row.value;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `updateDefaultSenderId: sender id ${senderId} has empty value`,
    );
  }

  await db.update("users", { id: userId }, { twilio_from_number: value });
  return { twilioFromNumber: value };
}