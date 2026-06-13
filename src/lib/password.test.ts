import { describe, expect, it } from "vitest";
import {
  BCRYPT_COST,
  MIN_PASSWORD_LENGTH,
  hashPassword,
  verifyPassword,
} from "@/lib/password";

/**
 * US-002 password hashing.
 *
 * - bcrypt cost 10 (spec)
 * - hashes are `$2b$10$...` and never contain the plaintext
 * - verifyPassword is constant-time against the plaintext (it
 *   always re-hashes) and never throws on a malformed hash
 */
describe("password hashing (US-002)", () => {
  it("BCRYPT_COST is 10", () => {
    expect(BCRYPT_COST).toBe(10);
  });

  it("MIN_PASSWORD_LENGTH is 8", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
  });

  it("hashes 'hunter2' to a bcrypt hash starting with $2b$10$", async () => {
    const h = await hashPassword("hunter2");
    expect(h).toMatch(/^\$2b\$10\$/);
  });

  it("hash is not the plaintext and does not contain the plaintext", async () => {
    const h = await hashPassword("hunter2");
    expect(h).not.toBe("hunter2");
    expect(h).not.toContain("hunter2");
  });

  it("two hashes of the same password are different (random salt)", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    expect(a).not.toBe(b);
  });

  it("verifyPassword returns true for the correct plaintext", async () => {
    const h = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", h)).toBe(true);
  });

  it("verifyPassword returns false for a wrong plaintext", async () => {
    const h = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", h)).toBe(false);
  });

  it("verifyPassword returns false for an empty hash without throwing", async () => {
    expect(await verifyPassword("hunter2", "")).toBe(false);
  });

  it("verifyPassword returns false for a malformed hash without throwing", async () => {
    expect(await verifyPassword("hunter2", "not-a-bcrypt-hash")).toBe(false);
  });

  it("hashPassword throws on an empty plaintext", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
