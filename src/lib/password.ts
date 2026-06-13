import bcrypt from "bcrypt";

/**
 * Password hashing.
 *
 * Uses bcrypt at cost 10 (the spec'd value for US-002). Cost 10 is
 * the default in the `bcrypt` npm package and a reasonable trade-off
 * between hashing time and brute-force resistance for a web app in
 * 2026 — ~100ms on a modern server, which is fine for a login flow
 * that runs once per user session.
 *
 * We never store plaintext. Every entry point that takes a password
 * (signup, password reset) MUST route through `hashPassword` and
 * store the result in `users.passwordHash`.
 */

/** bcrypt cost factor. Bumping it invalidates every existing hash. */
export const BCRYPT_COST = 10;

/** Minimum length enforced at the form layer. */
export const MIN_PASSWORD_LENGTH = 8;

/** Returns a bcrypt hash. Throws if the input is empty. */
export async function hashPassword(plaintext: string): Promise<string> {
  if (!plaintext) {
    throw new Error("hashPassword: plaintext must be a non-empty string");
  }
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Constant-time-ish comparison.
 *
 * `bcrypt.compare` already runs in constant time with respect to the
 * plaintext (it always re-hashes), so the only timing leak is the
 * length of the stored hash. We accept the hash as-is but bail out
 * early on a missing/garbage hash so we don't waste CPU on a full
 * bcrypt round when the input is obviously invalid.
 *
 * Returns `false` (never throws) so callers don't have to wrap it
 * in try/catch. This matters because the login route uses it as a
 * one-liner in the failure branch.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  if (!plaintext || !hash) return false;
  // bcrypt hashes always look like $2[aby]$NN$.... A 4-byte sanity
  // check is enough to fail fast on garbage.
  if (hash.length < 4 || !hash.startsWith("$2")) return false;
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}
