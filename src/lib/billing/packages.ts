/**
 * Credit-package catalog for the billing page (`/app/billing`).
 *
 * The mock billing provider reads these prices at checkout time; the
 * real Stripe provider will read them from Stripe's product catalog
 * (managed in the Stripe dashboard) — same shape, different source.
 *
 * Adding a new package:
 *   - Add a new entry below. The order in the array determines the
 *     order packages render in on the billing page.
 *   - Keep prices in USD CENTS (e.g. 500 = $5.00, not 5).
 *   - The `id` is a stable lookup key; the page and the tests use it
 *     to identify which package a button click referred to. Don't
 *     reuse ids even if you delete an entry — keep old ids retired.
 *   - Same package can be re-priced without changing `id`, but doing
 *     so breaks any in-flight checkout session that referenced the
 *     old price; old sessions still complete at the captured price.
 */
export interface CreditPackage {
  /** Stable lookup key. Safe for URLs and DB columns. */
  id: string;
  /** Number of credits granted when this package is purchased. */
  credits: number;
  /** Price in US dollar cents (e.g. 500 = $5.00). */
  priceUsdCents: number;
  /** Display name shown on the billing page. */
  name: string;
  /** Short marketing line shown under the price. */
  description: string;
}

export const PACKAGES: ReadonlyArray<CreditPackage> = [
  {
    id: "starter",
    credits: 100,
    priceUsdCents: 500,
    name: "Starter",
    description: "$5 for 100 credits. Good for trying things out.",
  },
  {
    id: "growth",
    credits: 500,
    priceUsdCents: 2000,
    name: "Growth",
    description: "$20 for 500 credits. Most small teams start here.",
  },
  {
    id: "scale",
    credits: 2000,
    priceUsdCents: 6000,
    name: "Scale",
    description: "$60 for 2,000 credits. Best per-credit price.",
  },
];

/**
 * Look up a package by its `id`. Returns `undefined` for unknown ids
 * so callers (checkout handler, tests) can fail loudly when an id
 * goes stale.
 */
export function getPackageById(id: string): CreditPackage | undefined {
  return PACKAGES.find((p) => p.id === id);
}

/**
 * Format `priceUsdCents` as a `$N.NN` display string. Centralized so
 * the billing page and the testing helpers render the same way.
 */
export function formatPriceUsd(priceUsdCents: number): string {
  const dollars = priceUsdCents / 100;
  return `$${dollars.toFixed(2)}`;
}
