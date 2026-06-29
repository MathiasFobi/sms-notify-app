"use server";

/**
 * Server actions for the Billing page (`/app/billing`).
 *
 * - `startCheckoutAction({ packageCredits })` — start a mock
 *   checkout session for the current user. Resolves the package by
 *   `credits`, asks the configured `BillingProvider` to create a
 *   session, and returns the URL the client should navigate to in
 *   order to "complete" payment (for the mock, that's the
 *   `/api/dev/stripe/confirm?session=<id>` simulator; for real
 *   Stripe it would be the hosted checkout page).
 *
 * The actual DB work is delegated to `__startCheckoutInternal`,
 * exported with the `__` prefix so unit tests can exercise it with a
 * fresh `TestDb` (no singleton coupling, no `requireUser()`
 * plumbing). Same shape as every other action file in
 * `src/lib/actions/`.
 *
 * NOTE: This is a `"use server"` file. Next.js 16 only allows async
 * functions (and type-only exports) from such files — re-exporting
 * schema table objects or the `PACKAGES` constant would break the
 * build. Importers grab them directly from `@/lib/billing/packages`
 * or `@/db/schema` instead.
 */

import { requireUser } from "@/lib/auth/require-user";
import { getBillingProvider, type BillingProvider } from "@/lib/billing";
import {
  PACKAGES,
  type CreditPackage,
} from "@/lib/billing/packages";
import { getTestDb, type TestDb } from "@/test/db";

// ============================================================================
// Public server actions
// ============================================================================

/**
 * Start a checkout session for `packageCredits`.
 *
 * `packageCredits` is the credit-package size the user picked (100 /
 * 500 / 2000). We resolve the matching catalog entry by `credits`,
 * ask the provider to create a session, and return the redirect URL.
 *
 * Returns `{ url, sessionId }` on success. The client form posts
 * back, awaits this action, and `window.location.assign`s to `url`
 * so the browser sees a full GET on the confirm endpoint (matching
 * real Stripe checkout navigation semantics).
 *
 * Throws on:
 *   - unknown `packageCredits` (no catalog entry has that size)
 *   - provider validation failure (mirrors `MockStripeProvider`'s
 *     own guards: non-integer ids, missing URLs)
 */
export async function startCheckoutAction(args: {
  packageCredits: number;
}): Promise<{ url: string; sessionId: number }> {
  const user = await requireUser();
  return __startCheckoutInternal({
    userId: user.id,
    packageCredits: args.packageCredits,
    db: getTestDb(),
    provider: getBillingProvider(),
  });
}

// ============================================================================
// Internal — directly testable
// ============================================================================

export interface StartCheckoutInput {
  userId: number;
  packageCredits: number;
  db: TestDb;
  /**
   * Override the billing provider. Production code uses
   * `getBillingProvider()`; tests pass a `MockStripeProvider`
   * (constructed against a fresh `createTestDb()`) so they can
   * assert on the inserted row directly.
   */
  provider: BillingProvider;
}

/**
 * Resolve the catalog entry for `packageCredits`, then delegate to
 * the configured `BillingProvider` to create a session. The provider
 * itself is responsible for inserting the `checkout_sessions` row —
 * we just relay the returned `url` and `sessionId` back to the
 * caller.
 *
 * Throws when no catalog entry matches `packageCredits`.
 */
export async function __startCheckoutInternal(
  input: StartCheckoutInput,
): Promise<{ url: string; sessionId: number }> {
  const { userId, packageCredits, provider } = input;

  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("startCheckout: userId must be a positive integer");
  }
  if (!Number.isInteger(packageCredits) || packageCredits <= 0) {
    throw new Error(
      "startCheckout: packageCredits must be a positive integer",
    );
  }

  const pkg = PACKAGES.find((p) => p.credits === packageCredits);
  if (!pkg) {
    throw new Error(
      `startCheckout: unknown packageCredits ${packageCredits} (no catalog entry matches)`,
    );
  }

  const result = await provider.createCheckoutSession({
    userId,
    packageCredits: pkg.credits,
    priceUsdCents: pkg.priceUsdCents,
    successUrl: "/app/billing?status=success",
    cancelUrl: "/app/billing?status=cancel",
  });

  return { url: result.url, sessionId: result.id };
}

// Re-export the catalog as a re-typed tuple so it's available to
// server-action consumers without crossing the `"use server"` /
// schema-import boundary. Type-only export so Next.js doesn't try
// to bundle the module here.
export type { CreditPackage };
// `PACKAGES` itself cannot be re-exported from a `"use server"` file
// because Next.js only ships async functions and types from these
// modules. Import it directly from "@/lib/billing/packages" instead.
