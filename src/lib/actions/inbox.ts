"use server";

/**
 * Server actions for the Inbox page (`/app/inbox`).
 *
 * - `markReadAction({ id })` — flip a single inbound message's
 *   `read` flag to `true` for the current user. Throws if the row
 *   doesn't exist or belongs to another user (same error in both
 *   cases — we don't want to leak row existence across users).
 *
 * - `markAllReadAction()` — flip every unread inbound for the current
 *   user to `read=true` in one call. Idempotent: calling it twice
 *   in a row is a no-op the second time. Used by the "Mark all read"
 *   button at the top of the inbox table.
 *
 * The actual DB work is delegated to `__markReadInternal` /
 * `__markAllReadInternal`, exported with the `__` prefix so unit
 * tests can exercise them directly with a fresh `TestDb` (no
 * singleton coupling, no `requireUser()` plumbing). Same shape as
 * every other action file in `src/lib/actions/`.
 *
 * After marking reads, the dashboard's "unread" count drops — see
 * `src/lib/dashboard.ts` (`getDashboardStats`). This is asserted
 * in the action tests by reading the count before and after.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getTestDb, type TestDb } from "@/test/db";

// NOTE: This is a `"use server"` file. Next.js 16 only allows async
// functions (and type-only exports) from such files — re-exporting
// schema table objects would break the build. Importers grab the
// schema directly from "@/db/schema" instead.

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Mark a single inbound message as read for the current user.
 *
 * Returns `{ id }` on success. Throws on:
 *   - non-positive `id`
 *   - row not found OR belongs to another user (same error)
 *   - row already read (no-op is fine; the call still succeeds and
 *     returns the id — flipping an already-true flag is a cheap
 *     no-op the database layer doesn't error on).
 */
export async function markReadAction(args: { id: number }): Promise<{
  id: number;
}> {
  const user = await requireUser();
  return __markReadInternal({
    userId: user.id,
    id: args.id,
    db: getTestDb(),
  });
}

/**
 * Mark every unread inbound message for the current user as read.
 *
 * Returns `{ updated }` with the number of rows that were flipped
 * (useful for surfacing a "5 marked as read" toast in a future UI
 * story). Already-read rows are NOT counted.
 *
 * Idempotent — calling it twice in a row returns `{ updated: 0 }`
 * the second time.
 */
export async function markAllReadAction(): Promise<{ updated: number }> {
  const user = await requireUser();
  return __markAllReadInternal({
    userId: user.id,
    db: getTestDb(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface MarkReadInput {
  userId: number;
  id: number;
  db: TestDb;
}

/**
 * Look up `id` scoped to `userId`, then flip its `read` column to
 * `true`. Throws if the row doesn't exist or belongs to another user
 * (single error message to avoid leaking existence).
 */
export async function __markReadInternal(
  input: MarkReadInput,
): Promise<{ id: number }> {
  const { userId, id, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("markRead: userId must be a positive integer");
  }
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("markRead: id must be a positive integer");
  }

  const rows = await db.select("inbound_messages", {
    id,
    user_id: userId,
  });
  if (rows.length === 0) {
    // Same error shape whether the row is missing or belongs to
    // another user — don't leak existence.
    throw new Error(`markRead: inbound message ${id} not found for user ${userId}`);
  }

  // Idempotent flip — the in-memory shim's `update` overwrites
  // without checking current value, so this is safe to call on an
  // already-read row.
  await db.update(
    "inbound_messages",
    { id, user_id: userId },
    { read: true },
  );
  return { id };
}

export interface MarkAllReadInput {
  userId: number;
  db: TestDb;
}

/**
 * Flip every unread inbound row scoped to `userId` to `read=true`.
 *
 * The shim's `select` only supports equality, so we read all rows
 * for the user (the inbox volume is small enough that this is fine)
 * and filter to `read=false` in-memory before updating. Each update
 * is scoped by `id` so we don't accidentally touch another user's
 * row if a stray cross-user id ever landed here.
 *
 * Returns the number of rows actually flipped.
 */
export async function __markAllReadInternal(
  input: MarkAllReadInput,
): Promise<{ updated: number }> {
  const { userId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("markAllRead: userId must be a positive integer");
  }

  const allRows = await db.select("inbound_messages", { user_id: userId });
  const unread = allRows.filter((r) => r.read !== true);

  let updated = 0;
  for (const row of unread) {
    const rowId = row.id as number;
    await db.update(
      "inbound_messages",
      { id: rowId, user_id: userId },
      { read: true },
    );
    updated++;
  }
  return { updated };
}

// ============================================================================
// Pure read helper — used by the inbox page server component.
// ============================================================================

export interface ListInboxInput {
  userId: number;
  db: TestDb;
}

export interface InboundMessageRow {
  id: number;
  fromPhone: string;
  toNumber: string;
  body: string;
  receivedAt: Date;
  read: boolean;
}

/**
 * Read every inbound message for `userId`, sorted newest-first by
 * `received_at`. Used by the `/app/inbox` page server component.
 *
 * Exported from this module (not from a separate `queries.ts`) so
 * the inbox view + its actions share one import path — keeps the
 * call sites tidy.
 */
export async function __listInboxInternal(
  input: ListInboxInput,
): Promise<InboundMessageRow[]> {
  const { userId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("listInbox: userId must be a positive integer");
  }

  const rows = await db.select("inbound_messages", { user_id: userId });
  const mapped: InboundMessageRow[] = rows.map((r) => ({
    id: r.id as number,
    fromPhone: String(r.from_phone ?? ""),
    toNumber: String(r.to_number ?? ""),
    body: String(r.body ?? ""),
    receivedAt: (r.received_at as Date | null) ?? new Date(0),
    read: r.read === true,
  }));
  // Newest first.
  mapped.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  return mapped;
}