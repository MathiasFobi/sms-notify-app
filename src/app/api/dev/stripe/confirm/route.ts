/**
 * GET /api/dev/stripe/confirm?session=<id>
 *
 * Dev-only "confirm payment" endpoint that backs the mock billing
 * provider's checkout flow. After
 * `MockStripeProvider.createCheckoutSession()` returns
 * `/api/dev/stripe/confirm?session=<id>`, the user lands here via a
 * `<form>` POST-back (see `/app/app/billing/page.tsx`'s
 * `PurchaseButton`). This handler:
 *
 *   1. Refuses to run in production (`NODE_ENV === 'production'`).
 *      Production builds must not expose a free-credits endpoint.
 *      Guarding on the env var (not just an `__override`) mirrors
 *      `/dev/webhooks` so the failure mode is the same across dev
 *      surfaces — call `notFound()` so the production build responds
 *      with a 404, not a 500.
 *
 *   2. Resolves the session by integer id (`?session=<id>`). 400 if
 *      the query param is missing or unparseable; 404 if no such
 *      session exists.
 *
 *   3. Idempotently flips the row to `completed`, increments
 *      `accounts.credits` by `package_credits`, and writes a
 *      `credit_transactions` row with `reason='purchase'` and
 *      `delta = +package_credits`. All three writes happen in
 *      sequence on the same `TestDb` (real Postgres will wrap them
 *      in a transaction once the live Drizzle client is wired in —
 *      see the comment at the bottom of this file).
 *
 *   4. Redirects the user back to `/app/billing` (303) so the
 *      billing page re-reads the updated balance + transaction
 *      history. If `redirect` query param is absent, the default is
 *      `/app/billing`. (The `PurchaseButton` component can override
 *      it via a hidden form field if a different landing page is
 *      needed in the future.)
 *
 * Why GET (and not POST): the redirect URL we hand back from
 * `MockStripeProvider.createCheckoutSession()` is a path the user
 * navigates to via `window.location.assign`. The browser issues a
 * GET. Real Stripe's hosted checkout also ends in a GET redirect
 * back to your success URL, so the contract is consistent.
 *
 * Auth: this endpoint does NOT call `requireUser()`. The session
 * row is scoped to `user_id`, and the credit-apply logic uses that
 * `user_id` to look up the account. The mock provider's id space
 * is global (so we can look up by primary key without auth); when
 * the real Stripe provider ships, this endpoint will validate the
 * Stripe-signed payload instead of trusting the query string.
 */

import { notFound } from "next/navigation";
import { getTestDb, type TestDb } from "@/test/db";

// ============================================================================
// Production guard — toggleable in tests
// ============================================================================

/**
 * Override hook for tests. Pass `true` to force the production
 * branch (so `notFound()` throws), `false` to force the dev branch
 * (so the handler runs), or `null` to fall back to
 * `process.env.NODE_ENV === 'production'`.
 */
let productionOverride: boolean | null = null;

export function __setConfirmProductionOverride(
  value: boolean | null,
): void {
  productionOverride = value;
}

function isProductionNow(): boolean {
  if (productionOverride !== null) return productionOverride;
  return process.env.NODE_ENV === "production";
}

// ============================================================================
// Pure helper — directly testable with any TestDb
// ============================================================================

export interface ConfirmCheckoutInput {
  /** Integer id of the `checkout_sessions` row to confirm. */
  sessionId: number;
  db: TestDb;
  /** Override-able clock so tests can assert on timestamps. */
  now: Date;
}

export type ConfirmCheckoutResult =
  /**
   * Session was confirmed successfully. Includes the credit delta
   * that was applied to the account.
   */
  | {
      result: "confirmed";
      sessionId: number;
      userId: number;
      creditsApplied: number;
      transactionId: number;
    }
  /** Session was already `completed` — return the existing data without double-applying the credit. */
  | {
      result: "already_completed";
      sessionId: number;
      userId: number;
    };

/**
 * Confirm a pending checkout session, apply the credits, and write
 * the audit row. Idempotent: a second call on an already-completed
 * session returns `already_completed` without double-applying.
 *
 * Throws when the session is not found OR belongs to a missing
 * account (the session row's `user_id` is honored — we look up
 * the account under that user; the user is resolved via the
 * `user_id` written at create time, NOT the current request's
 * authenticated user, because the mock doesn't carry auth on this
 * endpoint).
 *
 * The `stripe_session_id` we wrote at create-checkout time is the
 * foreign key into `webhook_events`, but the dev confirm endpoint
 * doesn't use it — the primary key lookup is good enough for the
 * mock. The real Stripe webhook handler (`handleWebhook`) is the
 * path for idempotency-on-replay in production.
 */
export async function __confirmCheckoutInternal(
  input: ConfirmCheckoutInput,
): Promise<ConfirmCheckoutResult> {
  const { sessionId, db, now } = input;

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new Error("confirmCheckout: sessionId must be a positive integer");
  }

  const sessionRows = await db.select("checkout_sessions", { id: sessionId });
  if (sessionRows.length === 0) {
    throw new Error(`confirmCheckout: session ${sessionId} not found`);
  }
  const session = sessionRows[0]!;
  const userId = session.user_id as number;
  const packageCredits = session.package_credits as number;

  // Idempotency: already completed. Don't touch the account, don't
  // write another credit_transactions row. Just report the user
  // the session belonged to so the route can render a sane response.
  if (session.status === "completed") {
    return { result: "already_completed", sessionId, userId };
  }

  // Refuse to "confirm" a cancelled session. Treating it like an
  // unknown id keeps the audit trail consistent.
  if (session.status === "cancelled") {
    throw new Error(
      `confirmCheckout: session ${sessionId} was cancelled; refusing to confirm`,
    );
  }

  // ---- Increment the account's credit balance ----------------------

  const accountRows = await db.select("accounts", { user_id: userId });
  if (accountRows.length === 0) {
    throw new Error(
      `confirmCheckout: account not found for user ${userId}`,
    );
  }
  const account = accountRows[0]!;
  const currentCredits =
    typeof account.credits === "number" ? account.credits : 0;
  await db.update(
    "accounts",
    { user_id: userId },
    { credits: currentCredits + packageCredits },
  );

  // ---- Write the audit row (positive delta) -------------------------

  const txn = await db.insert("credit_transactions", {
    user_id: userId,
    delta: packageCredits,
    reason: "purchase",
  });
  const transactionId = txn.id as number;

  // ---- Flip the session status -------------------------------------

  await db.update(
    "checkout_sessions",
    { id: sessionId },
    {
      status: "completed",
      completed_at: now,
    },
  );

  return {
    result: "confirmed",
    sessionId,
    userId,
    creditsApplied: packageCredits,
    transactionId,
  };
}

// ============================================================================
// Route handler
// ============================================================================

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Production guard — short-circuit BEFORE any DB read so the
  // endpoint leaks no information when it's accidentally reachable
  // from a production build.
  if (isProductionNow()) {
    notFound();
  }

  const url = new URL(request.url);
  const sessionRaw = url.searchParams.get("session");
  const redirectTo = url.searchParams.get("redirect") ?? "/app/billing";

  const sessionId = Number.parseInt(sessionRaw ?? "", 10);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return new Response(
      JSON.stringify({
        error:
          "session query param is required and must be a positive integer",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    const outcome = await __confirmCheckoutInternal({
      sessionId,
      db: getTestDb(),
      now: new Date(),
    });

    // Redirect back to the billing page so the user sees their
    // updated balance + transaction history. 303 See Other enforces
    // a GET on the next hop, even if the client somehow POSTed.
    return new Response(null, {
      status: 303,
      headers: { Location: redirectTo },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // Distinguish "not found" (404) from "invalid input" / unexpected
    // errors (400 / 500). For now both `not found` and `cancelled`
    // collapse to 404 — neither is "malformed request".
    if (
      /not found/i.test(message) ||
      /was cancelled/i.test(message)
    ) {
      return new Response(JSON.stringify({ error: message }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
