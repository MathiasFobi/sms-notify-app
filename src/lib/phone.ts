/**
 * Best-effort phone-number normalization.
 *
 * The goal is to convert free-form user input ("(555) 123-4567",
 * "5551234567", "+1 555 123 4567") into a stable E.164-ish string
 * so the `contacts` unique index on (user_id, phone) does the
 * right thing for duplicate detection. This is intentionally NOT
 * a full libphonenumber port — we just need:
 *
 *   1. Trim whitespace.
 *   2. Strip `(`, `)`, `-`, `.`, spaces.
 *   3. If the result already starts with `+`, leave the digits intact
 *      (preserving the country code the caller typed).
 *   4. If the result is 10 digits, prepend `+1` (US default).
 *   5. If the result is 11 digits starting with `1`, prepend `+`.
 *   6. If the result is 11+ digits not starting with `1`, just
 *      prepend `+` (treat as an international number).
 *   7. Anything else (e.g. fewer than 10 digits) throws — the caller
 *      will surface the error to the user.
 *
 * Anything more sophisticated (parsing metadata, validation against
 * carrier ranges, etc.) is out of scope for the mock build. When real
 * Twilio lands we can swap this for `libphonenumber-js` or a server-side
 * Twilio Lookup call without changing the call sites.
 */

/**
 * The phone types this normalizer accepts.
 *
 * - `string` — the most common case. Empty / whitespace-only throws.
 * - `null` / `undefined` — accepted and treated as "no number
 *   supplied". Useful for forms where phone is optional (we don't
 *   have that case today, but keeping it future-proof is cheap).
 */
export type PhoneInput = string | null | undefined;

/**
 * Normalize a phone number to best-effort E.164.
 *
 * Returns the canonicalized string, or `null` if the input was
 * `null` / `undefined`. Throws if the input is a non-empty string
 * that we can't make sense of.
 */
export function normalizePhone(input: PhoneInput): string | null {
  if (input === null || input === undefined) return null;

  if (typeof input !== "string") {
    throw new Error("normalizePhone: input must be a string");
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Strip the cosmetic characters people paste in: parens, dashes,
  // dots, spaces. Leading `+` is preserved.
  const stripped = trimmed.replace(/[\s().-]/g, "");

  if (stripped.length === 0) {
    throw new Error("normalizePhone: phone contains no digits");
  }

  // Already in international form. Keep the `+` and any digits
  // that follow; drop anything else that slipped past the strip
  // (defensive — e.g. if the caller pasted `+1-555-...` we want
  // digits only after the `+`).
  if (stripped.startsWith("+")) {
    const digits = stripped.slice(1).replace(/\D/g, "");
    if (digits.length < 8) {
      throw new Error(
        `normalizePhone: international number "${trimmed}" is too short`,
      );
    }
    return `+${digits}`;
  }

  // Otherwise we expect a pure-digit run.
  const digitsOnly = stripped.replace(/\D/g, "");
  if (!/^\d+$/.test(digitsOnly)) {
    throw new Error(`normalizePhone: phone "${trimmed}" has invalid characters`);
  }

  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`;
  }
  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    return `+${digitsOnly}`;
  }
  if (digitsOnly.length >= 11) {
    // International number typed without the `+`. Be permissive.
    return `+${digitsOnly}`;
  }
  throw new Error(
    `normalizePhone: phone "${trimmed}" is too short (need at least 10 digits)`,
  );
}