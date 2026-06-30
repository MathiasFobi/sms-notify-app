"use server";

/**
 * Server actions for the Contact Groups feature.
 *
 * - `createContactGroupAction({ name })` — create a new contact group
 *   for the current user. The row is scoped to `users.id`.
 *
 * - `renameContactGroupAction({ id, name })` — rename an existing group
 *   owned by the current user. Throws if the row doesn't exist OR
 *   belongs to another user (single error message — no existence leak).
 *
 * - `deleteContactGroupAction({ id })` — delete a group owned by the
 *   current user. The `contacts.group_id → contact_groups.id` FK is
 *   declared `ON DELETE SET NULL` in `src/db/schema.ts`, so deleting a
 *   group automatically clears `group_id` on every contact that
 *   pointed at it (handled by the in-memory shim's `applyFkcascade`
 *   helper today; real Postgres will enforce it natively).
 *
 * The actual DB work is delegated to the `__<name>Internal` exports,
 * which take explicit `{ userId, ..., db }` arguments so unit tests
 * can drive them with a fresh `createTestDb()` (no singleton coupling).
 * The public actions are 3-line wrappers that add `requireUser()` +
 * the singleton DB lookup. This mirrors the pattern established in
 * `src/lib/actions/sender-ids.ts`.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getTestDb, type TestDb } from "@/test/db";

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Create a contact group for the current user.
 *
 * Returns the assigned `id`. The name is trimmed of surrounding
 * whitespace before insert. Throws if `name` is empty after trim.
 */
export async function createContactGroupAction(args: {
  name: string;
}): Promise<{ id: number }> {
  const user = await requireUser();
  return __createContactGroupInternal({
    userId: user.id,
    name: args.name,
    db: getTestDb(),
  });
}

/**
 * Rename a contact group owned by the current user.
 *
 * Throws if the row doesn't exist, belongs to another user, or the
 * new `name` is empty after trim. The "belongs to another user" path
 * uses the same error message as "not found" so the server doesn't
 * leak row existence across users.
 */
export async function renameContactGroupAction(args: {
  id: number;
  name: string;
}): Promise<{ id: number; name: string }> {
  const user = await requireUser();
  return __renameContactGroupInternal({
    userId: user.id,
    groupId: args.id,
    name: args.name,
    db: getTestDb(),
  });
}

/**
 * Delete a contact group owned by the current user.
 *
 * Throws if the row doesn't exist or belongs to another user. The FK
 * `ON DELETE SET NULL` declared on `contacts.group_id` ensures any
 * contacts that pointed at this group have their `group_id` cleared
 * (verified in the action's test).
 */
export async function deleteContactGroupAction(args: {
  id: number;
}): Promise<{ id: number }> {
  const user = await requireUser();
  return __deleteContactGroupInternal({
    userId: user.id,
    groupId: args.id,
    db: getTestDb(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface CreateContactGroupInput {
  userId: number;
  name: string;
  db: TestDb;
}

/**
 * Insert a `contact_groups` row scoped to `userId`. Validates inputs,
 * trims `name`, and writes the row.
 *
 * Throws on:
 *   - non-positive userId
 *   - empty / whitespace-only name
 */
export async function __createContactGroupInternal(
  input: CreateContactGroupInput,
): Promise<{ id: number }> {
  const { userId, name, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("createContactGroup: userId must be a positive integer");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("createContactGroup: name is required");
  }

  const trimmed = name.trim();

  const inserted = await db.insert("contact_groups", {
    user_id: userId,
    name: trimmed,
  });
  return { id: inserted.id as number };
}

export interface RenameContactGroupInput {
  userId: number;
  groupId: number;
  name: string;
  db: TestDb;
}

/**
 * Rename a `contact_groups` row, scoped to `userId`. Validates inputs
 * and trims the new name.
 *
 * Throws on:
 *   - non-positive userId / groupId
 *   - empty / whitespace-only name
 *   - row not found OR belongs to another user (same error — no leak)
 */
export async function __renameContactGroupInternal(
  input: RenameContactGroupInput,
): Promise<{ id: number; name: string }> {
  const { userId, groupId, name, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("renameContactGroup: userId must be a positive integer");
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error("renameContactGroup: groupId must be a positive integer");
  }
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("renameContactGroup: name is required");
  }

  const trimmed = name.trim();

  // Look up the row scoped to the current user. This is the same
  // "single error message for missing and wrong-user" trick the
  // sender-ids actions use — we never want to reveal that a group
  // exists under a different user.
  const rows = await db.select("contact_groups", {
    id: groupId,
    user_id: userId,
  });
  if (rows.length === 0) {
    throw new Error(
      `renameContactGroup: group ${groupId} not found for user ${userId}`,
    );
  }

  await db.update("contact_groups", { id: groupId, user_id: userId }, {
    name: trimmed,
  });
  return { id: groupId, name: trimmed };
}

export interface DeleteContactGroupInput {
  userId: number;
  groupId: number;
  db: TestDb;
}

/**
 * Delete a `contact_groups` row, scoped to `userId`. The FK
 * `ON DELETE SET NULL` cascade is applied by the in-memory shim
 * (`applyFkcascade`) so any contacts in this group end up with
 * `group_id = null` after the call returns.
 *
 * Throws on:
 *   - non-positive userId / groupId
 *   - row not found OR belongs to another user (same error — no leak)
 */
export async function __deleteContactGroupInternal(
  input: DeleteContactGroupInput,
): Promise<{ id: number }> {
  const { userId, groupId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("deleteContactGroup: userId must be a positive integer");
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error("deleteContactGroup: groupId must be a positive integer");
  }

  const rows = await db.select("contact_groups", {
    id: groupId,
    user_id: userId,
  });
  if (rows.length === 0) {
    throw new Error(
      `deleteContactGroup: group ${groupId} not found for user ${userId}`,
    );
  }

  await db.delete("contact_groups", { id: groupId });
  return { id: groupId };
}