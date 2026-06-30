/**
 * Billing provider abstraction.
 *
 * Every Stripe (or Stripe-equivalent) call site in the app MUST go through
 * a `BillingProvider` so that:
 *  - Local development and tests never touch a real Stripe account.
 *  - The same call site can target different vendors by changing the
 *    `BILLING_PROVIDER` env var (`mock` | `stripe`).
 *  - The billing UI can be built and exercised against an in-memory
 *    implementation that records every state change to the DB.
 *
 * Spec (US-005):
 *  - `CheckoutSessionInput`  — the input shape every provider accepts
 *    when creating a checkout session.
 *  - `CheckoutSessionResult` — the URL the user should be redirected to
 *    in order to complete payment, plus the vendor's id for later
 *    lookups (webhook reconciliation, dev confirmations).
 *  - `BillingProvider`       — the swappable interface with
 *    `createCheckoutSession` and `handleWebhook`.
 */

/**
 * Input to `BillingProvider.createCheckoutSession()`.
 *
 * `packageCredits` is the credit-package size the user is buying
 * (e.g. 1000, 5000, 10000). `priceUsdCents` is the same in cents
 * (e.g. 4900 for $49.00). `successUrl` and `cancelUrl` are the
 * return URLs the user lands on after the checkout flow.
 */
export interface CheckoutSessionInput {
  userId: number;
  packageCredits: number;
  priceUsdCents: number;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Result of `BillingProvider.createCheckoutSession()`.
 *
 * - `id` is the internal primary-key of the `checkout_sessions` row —
 *   embed it in `successUrl` so the success page can look up the
 *   completed session.
 * - `url` is where the user should be redirected to start the
 *   payment. For the real Stripe provider this is
 *   `https://checkout.stripe.com/...`; for the mock provider this
 *   is the in-app `/api/dev/stripe/confirm?session=<id>` simulator.
 * - `stripeSessionId` is the vendor's session id — what the webhook
 *   handler will receive in its payload. For the mock we synthesize
 *   `mock_cs_<uuid>` so external lookups behave identically.
 */
export interface CheckoutSessionResult {
  id: number;
  url: string;
  stripeSessionId: string;
}

/**
 * The swappable billing provider interface.
 *
 * Implementations:
 *  - `MockStripeProvider` — in-process, records to the DB. See `./mock-provider.ts`.
 *  - `StripeProvider`     — real vendor (NOT YET IMPLEMENTED; see `./index.ts`).
 */
export interface BillingProvider {
  /**
   * Create a new checkout session for `userId` to buy
   * `packageCredits` for `priceUsdCents`. Persists a row in
   * `checkout_sessions` with status `pending` and returns the URL
   * the caller should redirect the user to.
   */
  createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;

  /**
   * Process a webhook from the billing vendor.
   *
   * `rawBody` is the unparsed request body (provider may need the
   * raw bytes to verify the signature). `signature` is the value of
   * the `Stripe-Signature` (or equivalent) header. For the mock this
   * is ignored entirely — there's no signature to verify.
   *
   * Returns `true` if the webhook was successfully processed,
   * `false` if the underlying session could not be found.
   */
  handleWebhook(rawBody: string, signature: string): Promise<boolean>;
}