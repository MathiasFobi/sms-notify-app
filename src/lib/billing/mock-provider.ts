import { randomUUID } from "node:crypto";
import { checkoutSessions, type CheckoutSession } from "@/db/schema";
import { getTableName, getTestDb, type TestDb } from "@/test/db";
import type {
  BillingProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
} from "./stripe";

/**
 * Cache the resolved table name so we don't pay the symbol-lookup cost
 * on every call. `Object.getOwnPropertySymbols` is cheap but not free.
 */
const CHECKOUT_SESSIONS_TABLE = getTableName(checkoutSessions);

/**
 * In-process mock billing provider.
 *
 * - Persists every checkout session to the `checkout_sessions` table via
 *   a `TestDb` resolved from `getTestDb()`. The real Stripe provider
 *   will use the live Drizzle/Postgres client; tests use the in-memory
 *   shim from `src/test/db.ts` so we don't need a database running to
 *   verify the billing layer.
 * - `createCheckoutSession()` writes a `pending` row and returns a
 *   confirmation URL at `/api/dev/stripe/confirm?session=<id>` — that
 *   route will be wired up in a later story to flip the session to
 *   `completed` and credit the user's account.
 * - `handleWebhook()` does no signature verification (there's nothing to
 *   verify in a mock) and just looks the row up by `stripeSessionId`
 *   to flip its status. The caller is expected to construct the
 *   `stripeSessionId` from the same source the provider used to
 *   generate it.
 *
 * Session id format: `mock_cs_<uuid>`. Using a `mock_cs_` prefix makes
 * it obvious in logs / the DB that the row came from the mock, and
 * mirrors how Stripe session ids look (`cs_test_...`).
 */
export class MockStripeProvider implements BillingProvider {
  /**
   * Optional override for the DB handle. When `undefined`, the provider
   * resolves the DB lazily via `getTestDb()` on first use. The override
   * exists so a caller can inject a fresh DB without going through the
   * global singleton (useful for hermetic tests).
   */
  private readonly dbOverride: TestDb | undefined;

  constructor(db?: TestDb) {
    this.dbOverride = db;
  }

  /** Resolve the active DB, preferring the override over the singleton. */
  private get db(): TestDb {
    return this.dbOverride ?? getTestDb();
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    // Basic validation — same posture as `MockSmsProvider`. Failures
    // surface as thrown errors because a malformed checkout request
    // is a programmer error (the API route already validated the
    // shape before getting here) and should never silently produce
    // a "pending" session.
    if (!input || typeof input !== "object") {
      throw new Error("createCheckoutSession: input is required");
    }
    const { userId, packageCredits, priceUsdCents } = input;
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error(
        "createCheckoutSession: userId must be a positive integer",
      );
    }
    if (!Number.isInteger(packageCredits) || packageCredits <= 0) {
      throw new Error(
        "createCheckoutSession: packageCredits must be a positive integer",
      );
    }
    if (!Number.isInteger(priceUsdCents) || priceUsdCents <= 0) {
      throw new Error(
        "createCheckoutSession: priceUsdCents must be a positive integer",
      );
    }
    if (typeof input.successUrl !== "string" || !input.successUrl) {
      throw new Error("createCheckoutSession: successUrl is required");
    }
    if (typeof input.cancelUrl !== "string" || !input.cancelUrl) {
      throw new Error("createCheckoutSession: cancelUrl is required");
    }

    // Synthesize the vendor session id. Real Stripe returns this from
    // the create-call; we mimic the shape so the rest of the code path
    // is identical.
    const stripeSessionId = `mock_cs_${randomUUID()}`;

    // Insert a `pending` row. Use the schema's snake_case column names
    // because the in-memory DB writes rows in the same shape as the
    // raw `SCHEMA_SQL`.
    const row = await this.db.insert(CHECKOUT_SESSIONS_TABLE, {
      user_id: userId,
      stripe_session_id: stripeSessionId,
      package_credits: packageCredits,
      price_usd_cents: priceUsdCents,
      status: "pending",
    });

    const id = row.id as number;

    return {
      id,
      url: `/api/dev/stripe/confirm?session=${id}`,
      stripeSessionId,
    };
  }

  async handleWebhook(rawBody: string, signature: string): Promise<boolean> {
    // The mock does NO signature verification. We accept any body +
    // signature, parse the `stripeSessionId` out, and flip the row.
    // Real Stripe verifies `signature` against `STRIPE_WEBHOOK_SECRET`
    // using the raw body bytes — that's the `rawBody` parameter's
    // job. The mock ignores both.
    void signature;

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return false;
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as Record<string, unknown>).stripeSessionId !== "string"
    ) {
      return false;
    }
    const stripeSessionId = (payload as Record<string, unknown>)
      .stripeSessionId as string;

    const matched = await this.db.select(CHECKOUT_SESSIONS_TABLE, {
      stripe_session_id: stripeSessionId,
    });
    if (matched.length === 0) {
      return false;
    }

    // Idempotency: if already completed, treat as success without
    // bumping `completedAt`. This mirrors how real Stripe webhook
    // handlers should behave on retries.
    if (matched[0].status === "completed") {
      return true;
    }

    const touched = await this.db.update(
      CHECKOUT_SESSIONS_TABLE,
      { stripe_session_id: stripeSessionId },
      {
        status: "completed",
        completed_at: new Date(),
      },
    );

    return touched > 0;
  }

  // ------------------------------------------------------------------
  // Test helpers
  // ------------------------------------------------------------------

  /**
   * Look up a checkout session by its primary key and return it in the
   * camelCase shape `CheckoutSession` consumers expect. The in-memory
   * DB stores rows in snake_case (matching `SCHEMA_SQL`); we map the
   * keys here so callers don't have to know which storage layer is
   * behind the provider. Mirrors the kind of query the future
   * `/api/dev/webhooks` page will need to render the session list.
   * Not part of the `BillingProvider` contract.
   */
  async getSessionById(id: number): Promise<CheckoutSession | null> {
    const rows = await this.db.select(CHECKOUT_SESSIONS_TABLE, { id });
    if (rows.length === 0) return null;
    return rowToCheckoutSession(rows[0]);
  }
}

/**
 * Map a snake_case row from the in-memory DB into the camelCase
 * `CheckoutSession` type that Drizzle normally returns to app code.
 * Real Drizzle does this transformation internally; we replicate it
 * here because the in-memory DB writes rows in raw SQL column shape.
 */
function rowToCheckoutSession(row: Record<string, unknown>): CheckoutSession {
  return {
    id: row.id as number,
    userId: row.user_id as number,
    stripeSessionId: row.stripe_session_id as string,
    packageCredits: row.package_credits as number,
    priceUsdCents: row.price_usd_cents as number,
    status: row.status as CheckoutSession["status"],
    createdAt: row.created_at as CheckoutSession["createdAt"],
    completedAt: (row.completed_at ?? null) as CheckoutSession["completedAt"],
  };
}