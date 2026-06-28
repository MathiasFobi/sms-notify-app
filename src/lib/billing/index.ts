import { MockStripeProvider } from "./mock-provider";
import type { BillingProvider } from "./stripe";

export type {
  BillingProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "./stripe";
export { MockStripeProvider } from "./mock-provider";

/**
 * Singleton billing provider.
 *
 * Default is `MockStripeProvider` so development, tests, and CI never
 * touch a real Stripe account. To enable the real Stripe provider (once
 * it exists), set `BILLING_PROVIDER=stripe` in the environment.
 *
 * NOTE: This module intentionally reads `process.env.BILLING_PROVIDER`
 * directly instead of going through `src/lib/env.ts` — we don't want
 * the billing layer to depend on Stripe secret keys, which are required
 * by env.ts at boot but are irrelevant when only the mock is in use.
 *
 * The mock provider resolves its backing `TestDb` lazily on first use
 * (see `src/test/db.ts`). In production this is fine — the test DB is
 * only constructed when the mock is used, and the mock will be
 * superseded by the real Stripe provider before any billing call site
 * ships.
 */
let cached: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (cached) return cached;

  const providerName = process.env.BILLING_PROVIDER;

  if (providerName === "stripe") {
    // TODO: implement StripeProvider in ./stripe-provider.ts.
    // Throw for now so a misconfigured deployment fails loudly rather
    // than silently running through the mock in production.
    throw new Error(
      "BILLING_PROVIDER=stripe is set, but StripeProvider is not implemented yet. " +
        "Create src/lib/billing/stripe-provider.ts and wire it up here.",
    );
  }

  // Default — and currently the only — implementation.
  // TODO: when `stripe-provider.ts` exists, the `stripe` branch above
  // will construct it instead.
  cached = new MockStripeProvider();
  return cached;
}

/**
 * Test helper: reset the cached singleton so the next `getBillingProvider()`
 * call constructs a fresh `MockStripeProvider`. Pair this with
 * `__resetTestDbForTests()` (from `@/test/db`) for full isolation.
 * Never call this from production code.
 */
export function __resetBillingProviderForTests(): void {
  cached = null;
}