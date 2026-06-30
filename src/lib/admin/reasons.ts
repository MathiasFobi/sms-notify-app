/**
 * Catalog of allowed "admin adjust credits" reasons.
 *
 * Lives in its own module (NOT inside `src/lib/actions/admin.ts`)
 * because the latter is a `"use server"` file — Next.js 16 only
 * allows async function exports from such files, and a `readonly
 * tuple` constant would fail the build.
 *
 * Importers should grab this constant from `@/lib/admin/reasons`
 * and use `isAdminAdjustReason()` for runtime validation.
 */

export const ADMIN_ADJUST_REASONS = [
  "support",
  "refund",
  "goodwill",
  "correction",
  "chargeback",
] as const;

export type AdminAdjustReason = (typeof ADMIN_ADJUST_REASONS)[number];

/**
 * Type-guard for an arbitrary string value against the reason
 * catalog. Returns `true` when `value` is one of the allowed
 * labels.
 */
export function isAdminAdjustReason(value: unknown): value is AdminAdjustReason {
  return (
    typeof value === "string" &&
    (ADMIN_ADJUST_REASONS as readonly string[]).includes(value)
  );
}