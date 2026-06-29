"use server";

/**
 * Server actions for the Contacts feature (`/app/contacts`).
 *
 * - `addContactAction({ phone, firstName?, lastName?, groupId? })` —
 *   add a single contact for the current user. Phone is normalized to
 *   E.164 best-effort. Duplicate (userId, phone) is rejected.
 *
 * - `editContactAction({ id, phone?, firstName?, lastName?, groupId? })` —
 *   update an existing contact's mutable fields. Only the keys you
 *   supply are changed. Same duplicate check on phone when supplied.
 *
 * - `deleteContactAction({ id })` — delete a contact owned by the
 *   current user. Throws if the row doesn't belong to the current user.
 *
 * - `importContactsAction({ csv })` — parse a CSV string (header row
 *   + data rows; columns: `phone,firstName,lastName,groupId`) and
 *   insert each row for the current user. Duplicates within the
 *   import AND against existing contacts are skipped (the rest still
 *   import). The returned summary counts what happened.
 *
 * - `exportContactsCsv()` — return `{ filename, csv }` for the
 *   current user's contacts, ordered by createdAt ASC.
 *
 * The actual DB work is delegated to `__<name>Internal` exports so
 * unit tests can drive them with a fresh `createTestDb()` (no
 * singleton coupling). The public actions are thin wrappers that
 * add `requireUser()` + the singleton DB. This mirrors the pattern
 * established by `src/lib/actions/sender-ids.ts` and
 * `src/lib/actions/contact-groups.ts`.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getTestDb, type TestDb } from "@/test/db";
import { normalizePhone } from "@/lib/phone";

// NOTE: This is a `"use server"` file. Next.js 16 only allows async
// functions (and type-only exports) from such files — re-exporting
// schema table objects would fail the build. The page imports the
// schema directly from "@/db/schema" instead.

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Add a single contact for the current user.
 *
 * Returns the new contact's `id`. Phone is normalized to E.164.
 * Throws if the phone is invalid or already exists for this user.
 */
export async function addContactAction(args: {
  phone: string;
  firstName?: string;
  lastName?: string;
  groupId?: number | null;
}): Promise<{ id: number }> {
  const user = await requireUser();
  return __addContactInternal({
    userId: user.id,
    phone: args.phone,
    firstName: args.firstName,
    lastName: args.lastName,
    groupId: args.groupId ?? null,
    db: getTestDb(),
  });
}

/**
 * Edit a contact owned by the current user.
 *
 * Only the keys you supply are updated. Pass `groupId: null` to
 * clear the group assignment. Phone (if supplied) is re-normalized
 * and re-checked for duplicates.
 *
 * Throws if the contact belongs to another user, doesn't exist, or
 * the new phone duplicates another of the current user's contacts.
 */
export async function editContactAction(args: {
  id: number;
  phone?: string;
  firstName?: string | null;
  lastName?: string | null;
  groupId?: number | null;
}): Promise<{ id: number }> {
  const user = await requireUser();
  return __editContactInternal({
    userId: user.id,
    contactId: args.id,
    phone: args.phone,
    firstName: args.firstName,
    lastName: args.lastName,
    groupId: args.groupId,
    db: getTestDb(),
  });
}

/**
 * Delete a contact owned by the current user. Throws if the row
 * belongs to another user or doesn't exist (single error message —
 * no existence leak).
 */
export async function deleteContactAction(args: {
  id: number;
}): Promise<{ id: number }> {
  const user = await requireUser();
  return __deleteContactInternal({
    userId: user.id,
    contactId: args.id,
    db: getTestDb(),
  });
}

/**
 * Import contacts from a CSV string for the current user.
 *
 * Expected header (case-insensitive): `phone,firstName,lastName,groupId`.
 * Extra columns are ignored. Missing required values are tolerated —
 * a row with no phone is skipped. Duplicates within the CSV AND
 * against existing contacts are skipped (the rest still import).
 *
 * Returns a summary of what happened so the UI can show a
 * confirmation toast.
 */
export async function importContactsAction(args: {
  csv: string;
}): Promise<{
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}> {
  const user = await requireUser();
  return __importContactsInternal({
    userId: user.id,
    csv: args.csv,
    db: getTestDb(),
  });
}

/**
 * Export the current user's contacts as a CSV string.
 *
 * The format mirrors the import format so a round-trip (export
 * then import) is a no-op. The filename is a stable timestamped
 * string suitable for `Content-Disposition`.
 */
export async function exportContactsCsv(): Promise<{
  filename: string;
  csv: string;
}> {
  const user = await requireUser();
  return __exportContactsInternal({ userId: user.id, db: getTestDb() });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface AddContactInput {
  userId: number;
  phone: string;
  firstName?: string | null;
  lastName?: string | null;
  groupId?: number | null;
  db: TestDb;
}

/**
 * Insert a `contacts` row scoped to `userId`. Validates inputs,
 * normalizes phone to E.164, and rejects duplicates within the
 * same user.
 *
 * Throws on:
 *   - non-positive userId / groupId
 *   - missing / unparseable phone
 *   - duplicate (userId, phone)
 */
export async function __addContactInternal(
  input: AddContactInput,
): Promise<{ id: number }> {
  const { userId, phone, firstName, lastName, groupId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("addContact: userId must be a positive integer");
  }

  const normalized = normalizePhone(phone);
  if (normalized === null || normalized.length === 0) {
    throw new Error("addContact: phone is required");
  }

  if (groupId !== null && groupId !== undefined) {
    if (!Number.isInteger(groupId) || groupId <= 0) {
      throw new Error("addContact: groupId must be a positive integer");
    }
    // Verify the group exists and belongs to this user. Use the same
    // single-error-message trick we use elsewhere — we don't want to
    // leak whether a given id exists under another user.
    const groups = await db.select("contact_groups", {
      id: groupId,
      user_id: userId,
    });
    if (groups.length === 0) {
      throw new Error(
        `addContact: contact group ${groupId} not found for user ${userId}`,
      );
    }
  }

  // Duplicate check — the table has a unique index on (user_id, phone)
  // but the in-memory shim doesn't enforce it; do it explicitly so we
  // can surface a readable error.
  const existing = await db.select("contacts", {
    user_id: userId,
    phone: normalized,
  });
  if (existing.length > 0) {
    throw new Error(
      `addContact: contact with phone "${normalized}" already exists for this user`,
    );
  }

  const trimmedFirst =
    typeof firstName === "string" && firstName.trim().length > 0
      ? firstName.trim()
      : null;
  const trimmedLast =
    typeof lastName === "string" && lastName.trim().length > 0
      ? lastName.trim()
      : null;

  const inserted = await db.insert("contacts", {
    user_id: userId,
    phone: normalized,
    first_name: trimmedFirst,
    last_name: trimmedLast,
    group_id: groupId ?? null,
  });
  return { id: inserted.id as number };
}

export interface EditContactInput {
  userId: number;
  contactId: number;
  phone?: string;
  firstName?: string | null;
  lastName?: string | null;
  groupId?: number | null;
  db: TestDb;
}

/**
 * Update a `contacts` row scoped to `userId`. Only fields explicitly
 * supplied are changed. Phone (if supplied) is re-normalized and
 * re-checked for duplicates.
 *
 * `groupId: null` clears the group assignment (the schema's
 * `ON DELETE SET NULL` would also do this, but we want explicit
 * control from the UI). Pass `groupId: <number>` to reassign.
 *
 * Throws on:
 *   - non-positive userId / contactId
 *   - row not found OR belongs to another user (same error — no leak)
 *   - new phone invalid or duplicates another of this user's contacts
 *   - new groupId refers to a group the user doesn't own
 */
export async function __editContactInternal(
  input: EditContactInput,
): Promise<{ id: number }> {
  const {
    userId,
    contactId,
    phone,
    firstName,
    lastName,
    groupId,
    db,
  } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("editContact: userId must be a positive integer");
  }
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new Error("editContact: contactId must be a positive integer");
  }

  const rows = await db.select("contacts", {
    id: contactId,
    user_id: userId,
  });
  if (rows.length === 0) {
    throw new Error(
      `editContact: contact ${contactId} not found for user ${userId}`,
    );
  }

  const update: Record<string, unknown> = {};

  if (phone !== undefined) {
    const normalized = normalizePhone(phone);
    if (normalized === null || normalized.length === 0) {
      throw new Error("editContact: phone cannot be empty");
    }
    // Duplicate check — exclude the row we're editing.
    const dupes = await db.select("contacts", {
      user_id: userId,
      phone: normalized,
    });
    const conflictsWithOther = dupes.some((r) => r.id !== contactId);
    if (conflictsWithOther) {
      throw new Error(
        `editContact: contact with phone "${normalized}" already exists for this user`,
      );
    }
    update.phone = normalized;
  }

  if (firstName !== undefined) {
    update.first_name =
      typeof firstName === "string" && firstName.trim().length > 0
        ? firstName.trim()
        : null;
  }

  if (lastName !== undefined) {
    update.last_name =
      typeof lastName === "string" && lastName.trim().length > 0
        ? lastName.trim()
        : null;
  }

  if (groupId !== undefined) {
    if (groupId === null) {
      update.group_id = null;
    } else {
      if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error(
          "editContact: groupId must be a positive integer or null",
        );
      }
      const groups = await db.select("contact_groups", {
        id: groupId,
        user_id: userId,
      });
      if (groups.length === 0) {
        throw new Error(
          `editContact: contact group ${groupId} not found for user ${userId}`,
        );
      }
      update.group_id = groupId;
    }
  }

  if (Object.keys(update).length === 0) {
    // Nothing to update — just return the id so the caller can treat
    // this as a successful no-op.
    return { id: contactId };
  }

  await db.update("contacts", { id: contactId, user_id: userId }, update);
  return { id: contactId };
}

export interface DeleteContactInput {
  userId: number;
  contactId: number;
  db: TestDb;
}

/**
 * Delete a `contacts` row scoped to `userId`. The
 * `message_recipients.contact_id` FK is `ON DELETE SET NULL`, so
 * existing delivery records lose their contact link but keep their
 * snapshot data (the schema's snapshot-at-send pattern means the
 * phone is already preserved on the recipient row).
 *
 * Throws on:
 *   - non-positive userId / contactId
 *   - row not found OR belongs to another user (same error — no leak)
 */
export async function __deleteContactInternal(
  input: DeleteContactInput,
): Promise<{ id: number }> {
  const { userId, contactId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("deleteContact: userId must be a positive integer");
  }
  if (!Number.isInteger(contactId) || contactId <= 0) {
    throw new Error("deleteContact: contactId must be a positive integer");
  }

  const rows = await db.select("contacts", {
    id: contactId,
    user_id: userId,
  });
  if (rows.length === 0) {
    throw new Error(
      `deleteContact: contact ${contactId} not found for user ${userId}`,
    );
  }

  await db.delete("contacts", { id: contactId });
  return { id: contactId };
}

export interface ImportContactsInput {
  userId: number;
  csv: string;
  db: TestDb;
}

/**
 * Parse a CSV blob and insert each row as a contact for `userId`.
 *
 * Expected header (case-insensitive):
 *   phone,firstName,lastName,groupId
 *
 * Behavior:
 *   - Empty / whitespace-only phone rows are skipped.
 *   - Rows that fail phone normalization are collected as errors
 *     with the 1-based row number (excluding the header).
 *   - Duplicate (userId, phone) within the CSV are skipped.
 *   - Duplicate (userId, phone) against pre-existing contacts are
 *     skipped.
 *   - `groupId` is optional. If supplied, it must refer to a group
 *     the user owns (otherwise the row is reported as an error).
 *
 * Returns a summary: `{ inserted, skipped, errors }`.
 */
export async function __importContactsInternal(
  input: ImportContactsInput,
): Promise<{
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}> {
  const { userId, csv, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("importContacts: userId must be a positive integer");
  }
  if (typeof csv !== "string") {
    throw new Error("importContacts: csv must be a string");
  }

  const parsed = parseCsv(csv);
  if (parsed.rows.length === 0) {
    return { inserted: 0, skipped: 0, errors: [] };
  }

  const header = parsed.rows[0]!.map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf("phone");
  const firstNameIdx = header.indexOf("firstname");
  const lastNameIdx = header.indexOf("lastname");
  const groupIdIdx = header.indexOf("groupid");

  if (phoneIdx === -1) {
    throw new Error(
      'importContacts: CSV is missing required "phone" column',
    );
  }

  // Cache for the per-import dedupe check (so two rows in the same
  // CSV with the same phone don't both get inserted).
  const seenInImport = new Set<string>();

  let inserted = 0;
  let skipped = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let i = 1; i < parsed.rows.length; i++) {
    const rowNum = i; // 1-based row number, excluding the header.
    const row = parsed.rows[i]!;
    const phone = (row[phoneIdx] ?? "").trim();
    if (phone.length === 0) {
      skipped++;
      continue;
    }

    let normalized: string;
    try {
      const n = normalizePhone(phone);
      if (n === null) {
        skipped++;
        continue;
      }
      normalized = n;
    } catch (err) {
      errors.push({
        row: rowNum,
        message: err instanceof Error ? err.message : "invalid phone",
      });
      continue;
    }

    if (seenInImport.has(normalized)) {
      skipped++;
      continue;
    }

    // Duplicate check against existing contacts for this user.
    const existing = await db.select("contacts", {
      user_id: userId,
      phone: normalized,
    });
    if (existing.length > 0) {
      seenInImport.add(normalized);
      skipped++;
      continue;
    }

    const firstName =
      firstNameIdx !== -1
        ? (row[firstNameIdx] ?? "").trim() || null
        : null;
    const lastName =
      lastNameIdx !== -1 ? (row[lastNameIdx] ?? "").trim() || null : null;

    let resolvedGroupId: number | null = null;
    if (groupIdIdx !== -1) {
      const raw = (row[groupIdIdx] ?? "").trim();
      if (raw.length > 0) {
        const parsedId = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsedId) || parsedId <= 0) {
          errors.push({
            row: rowNum,
            message: `invalid groupId "${raw}"`,
          });
          continue;
        }
        const groups = await db.select("contact_groups", {
          id: parsedId,
          user_id: userId,
        });
        if (groups.length === 0) {
          errors.push({
            row: rowNum,
            message: `groupId ${parsedId} not found for user ${userId}`,
          });
          continue;
        }
        resolvedGroupId = parsedId;
      }
    }

    await db.insert("contacts", {
      user_id: userId,
      phone: normalized,
      first_name: firstName,
      last_name: lastName,
      group_id: resolvedGroupId,
    });
    seenInImport.add(normalized);
    inserted++;
  }

  return { inserted, skipped, errors };
}

export interface ExportContactsInput {
  userId: number;
  db: TestDb;
}

/**
 * Return the current user's contacts as a CSV blob, ordered by
 * `created_at` ASC (matches the page's table order). The CSV uses
 * the same header as the import format so a round-trip works.
 *
 * `filename` is a timestamped slug suitable for `Content-Disposition`.
 */
export async function __exportContactsInternal(
  input: ExportContactsInput,
): Promise<{ filename: string; csv: string }> {
  const { userId, db } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("exportContacts: userId must be a positive integer");
  }

  const rows = await db.select("contacts", { user_id: userId });
  rows.sort((a, b) => {
    const aTime = a.created_at instanceof Date ? a.created_at.getTime() : 0;
    const bTime = b.created_at instanceof Date ? b.created_at.getTime() : 0;
    return aTime - bTime;
  });

  const header = ["phone", "firstName", "lastName", "groupId"];
  const lines: string[] = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(String(r.phone ?? "")),
        csvEscape(r.first_name == null ? "" : String(r.first_name)),
        csvEscape(r.last_name == null ? "" : String(r.last_name)),
        csvEscape(r.group_id == null ? "" : String(r.group_id)),
      ].join(","),
    );
  }

  // Stable filename (UTC, ISO date + safe time).
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const filename = `contacts-${yyyy}${mm}${dd}-${hh}${mi}.csv`;

  return { filename, csv: lines.join("\n") + "\n" };
}

// ============================================================================
// CSV helpers — minimal RFC-4180-ish parser, no external deps.
// ============================================================================

interface ParsedCsv {
  rows: string[][];
}

/**
 * Parse a CSV string into a 2D array.
 *
 * Handles:
 *   - Quoted fields containing commas / newlines.
 *   - Escaped quotes (`""` inside a quoted field).
 *   - Trailing newline / carriage returns.
 *
 * Does NOT handle:
 *   - Custom delimiters.
 *   - Type coercion (everything stays a string).
 */
function parseCsv(input: string): ParsedCsv {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote inside a quoted field.
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
      // End of record. Tolerate \r\n by skipping the next \n.
      row.push(field);
      field = "";
      // Skip the row if it's an empty line (often trailing).
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

  return { rows };
}

/**
 * Escape a value for CSV output. Wraps the value in double quotes
 * when it contains a comma, newline, or quote, and doubles any
 * embedded quotes.
 */
function csvEscape(value: string): string {
  if (
    value.includes(",") ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.includes('"')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// (No schema re-exports here — see the NOTE at the top of the file.)