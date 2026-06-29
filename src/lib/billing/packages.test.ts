/**
 * Tests for `src/lib/billing/packages.ts` (US-016).
 *
 * Three coverage angles:
 *
 *   1. The catalog shape — there are at least three entries, each
 *      has the required fields (credits, priceUsdCents), and the
 *      dollar amounts match the per-credit math the story calls
 *      out (100/$5, 500/$20, 2000/$60).
 *
 *   2. Lookup helpers — `getPackageById` resolves a known id and
 *      returns `undefined` for an unknown one.
 *
 *   3. `formatPriceUsd` — formatting cents as `$N.NN`.
 */
import { describe, expect, it } from "vitest";
import {
  formatPriceUsd,
  getPackageById,
  PACKAGES,
  type CreditPackage,
} from "@/lib/billing/packages";

describe("PACKAGES catalog", () => {
  it("has at least three entries (story requirement)", () => {
    expect(PACKAGES.length).toBeGreaterThanOrEqual(3);
  });

  it("every entry has credit/price/name/description fields populated", () => {
    for (const pkg of PACKAGES) {
      expect(pkg.id).toBeTypeOf("string");
      expect(pkg.id.length).toBeGreaterThan(0);
      expect(pkg.credits).toBeTypeOf("number");
      expect(Number.isInteger(pkg.credits)).toBe(true);
      expect(pkg.credits).toBeGreaterThan(0);
      expect(pkg.priceUsdCents).toBeTypeOf("number");
      expect(Number.isInteger(pkg.priceUsdCents)).toBe(true);
      expect(pkg.priceUsdCents).toBeGreaterThan(0);
      expect(pkg.name).toBeTypeOf("string");
      expect(pkg.name.length).toBeGreaterThan(0);
      expect(pkg.description).toBeTypeOf("string");
      expect(pkg.description.length).toBeGreaterThan(0);
    }
  });

  it("includes the three canonical sizes from the story (100 / 500 / 2000 credits)", () => {
    const creditsList = PACKAGES.map((p) => p.credits).sort((a, b) => a - b);
    expect(creditsList).toContain(100);
    expect(creditsList).toContain(500);
    expect(creditsList).toContain(2000);
  });

  it("matches the canonical prices from the story (100/$5, 500/$20, 2000/$60)", () => {
    const byCredits = new Map<number, number>(
      PACKAGES.map((p) => [p.credits, p.priceUsdCents]),
    );
    expect(byCredits.get(100)).toBe(500);
    expect(byCredits.get(500)).toBe(2000);
    expect(byCredits.get(2000)).toBe(6000);
  });

  it("uses unique ids so a lookup always resolves to a single entry", () => {
    const ids = PACKAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses unique credit sizes so a checkout lookup never picks two packages", () => {
    const credits = PACKAGES.map((p) => p.credits);
    expect(new Set(credits).size).toBe(credits.length);
  });

  it("exposes CreditPackage as a typed union (compile-time check, no runtime cost)", () => {
    const sample: CreditPackage = PACKAGES[0]!;
    const credits: number = sample.credits;
    const priceUsdCents: number = sample.priceUsdCents;
    expect(credits).toBeTypeOf("number");
    expect(priceUsdCents).toBeTypeOf("number");
  });
});

describe("getPackageById()", () => {
  it("resolves a known id to the matching package", () => {
    // Use the first entry so the test doesn't go stale if the
    // catalog is reordered.
    const known = PACKAGES[0]!;
    const found = getPackageById(known.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(known.id);
    expect(found!.credits).toBe(known.credits);
    expect(found!.priceUsdCents).toBe(known.priceUsdCents);
  });

  it("returns undefined for an unknown id", () => {
    expect(getPackageById("definitely-not-a-package")).toBeUndefined();
  });

  it("returns undefined for the empty string", () => {
    expect(getPackageById("")).toBeUndefined();
  });
});

describe("formatPriceUsd()", () => {
  it("formats 500 cents as $5.00", () => {
    expect(formatPriceUsd(500)).toBe("$5.00");
  });

  it("formats 2000 cents as $20.00", () => {
    expect(formatPriceUsd(2000)).toBe("$20.00");
  });

  it("formats 6000 cents as $60.00", () => {
    expect(formatPriceUsd(6000)).toBe("$60.00");
  });

  it("formats odd cents with two decimals (no rounding surprises)", () => {
    expect(formatPriceUsd(499)).toBe("$4.99");
    expect(formatPriceUsd(1)).toBe("$0.01");
    expect(formatPriceUsd(99)).toBe("$0.99");
  });
});
