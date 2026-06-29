/**
 * Tests for GET /api/dev/stripe/confirm (US-016).
 *
 * Three layers:
 *
 *   1. Production guard — calling the route when
 *      `__setConfirmProductionOverride(true)` flips the guard returns
 *      `notFound()` (a thrown error). Setting it back to `false`
 *      (or null) lets the route run normally.
 *
 *   2. Pure helper `__confirmCheckoutInternal` — exercised against a
 *      fresh `createTestDb()`. Covers:
 *        - Pending → confirmed, credits applied to the account,
 *          credit_transactions row written with `reason='purchase'`
 *          and `delta=+package_credits`.
 *        - Already-completed session → `already_completed` result,
 *          no double-apply.
 *        - Cancelled session → throws.
 *        - Unknown session id → throws.
 *
 *   3. Route handler — the `GET(request)` surface, including the
 *      303 redirect back to `/app/billing`, the 400 missing-param
 *      path, and the 404 paths for unknown / cancelled sessions.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetBillingProviderForTests,
  MockStripeProvider,
} from "@/lib/billing";
import {
  __confirmCheckoutInternal,
  __setConfirmProductionOverride,
  type ConfirmCheckoutInput,
  type ConfirmCheckoutResult,
} from "@/app/api/dev/stripe/confirm/route";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";

// ============================================================================
// Route handler plumbing
// ============================================================================

interface RouteModule {
  GET: (request: Request) => Promise<Response>;
}

async function callConfirmRoute(request: Request): Promise<Response> {
  const mod = (await import(
    "@/app/api/dev/stripe/confirm/route"
  )) as unknown as RouteModule;
  return mod.GET(request);
}

// ============================================================================
// Fixtures
// ============================================================================

interface SeededCheckout {
  db: TestDb;
  userId: number;
  sessionId: number;
  packageCredits: number;
}

/**
 * Build a user + account + a pending checkout session. Uses a
 * freshly-injected TestDb so the helper tests don't depend on the
 * singleton.
 */
async function seedPendingCheckout(
  db: TestDb,
  credits: number,
): Promise<SeededCheckout> {
  const u = await db.insert("users", {
    email: "buyer@example.com",
    password_hash: "x",
    name: "Buyer",
  });
  const userId = u.id as number;
  await db.insert("accounts", {
    user_id: userId,
    credits: 0,
    plan: "free",
  });
  // Use the provider's own logic to write the session — same path
  // the action takes in production.
  const provider = new MockStripeProvider(db);
  const result = await provider.createCheckoutSession({
    userId,
    packageCredits: credits,
    priceUsdCents: 500,
    successUrl: "/app/billing?status=success",
    cancelUrl: "/app/billing?status=cancel",
  });
  return {
    db,
    userId,
    sessionId: result.id,
    packageCredits: credits,
  };
}

function asInput(partial: {
  sessionId: number;
  db: TestDb;
}): ConfirmCheckoutInput {
  return {
    sessionId: partial.sessionId,
    db: partial.db,
    now: new Date("2026-06-29T12:00:00.000Z"),
  };
}

// ============================================================================
// Pure helper tests
// ============================================================================

describe("__confirmCheckoutInternal (US-016)", () => {
  it("flips status='completed', credits the account, and writes a purchase transaction", async () => {
    const db = createTestDb();
    const seeded = await seedPendingCheckout(db, 500);

    // Sanity: pre-state.
    const beforeAccounts = await db.select("accounts", {
      user_id: seeded.userId,
    });
    expect(beforeAccounts[0]!.credits).toBe(0);
    const beforeSessions = await db.select("checkout_sessions", {
      id: seeded.sessionId,
    });
    expect(beforeSessions[0]!.status).toBe("pending");
    expect(beforeSessions[0]!.completed_at).toBeUndefined();

    const outcome: ConfirmCheckoutResult = await __confirmCheckoutInternal(
      asInput({ sessionId: seeded.sessionId, db }),
    );

    expect(outcome.result).toBe("confirmed");
    if (outcome.result !== "confirmed") throw new Error("unreachable");
    expect(outcome.sessionId).toBe(seeded.sessionId);
    expect(outcome.userId).toBe(seeded.userId);
    expect(outcome.creditsApplied).toBe(500);
    expect(outcome.transactionId).toBeGreaterThan(0);

    // Session: completed + completed_at stamped.
    const sessions = await db.select("checkout_sessions", {
      id: seeded.sessionId,
    });
    expect(sessions[0]!.status).toBe("completed");
    expect(sessions[0]!.completed_at).toBeInstanceOf(Date);
    expect((sessions[0]!.completed_at as Date).toISOString()).toBe(
      "2026-06-29T12:00:00.000Z",
    );

    // Account: credits bumped by package_credits.
    const accounts = await db.select("accounts", { user_id: seeded.userId });
    expect(accounts[0]!.credits).toBe(500);

    // Transaction: positive delta + purchase reason.
    const txns = await db.select("credit_transactions", {
      user_id: seeded.userId,
    });
    expect(txns).toHaveLength(1);
    expect(txns[0]!.delta).toBe(500);
    expect(txns[0]!.reason).toBe("purchase");
  });

  it("is idempotent — calling confirm twice does not double-apply credits", async () => {
    const db = createTestDb();
    const seeded = await seedPendingCheckout(db, 2000);

    const first = await __confirmCheckoutInternal(
      asInput({ sessionId: seeded.sessionId, db }),
    );
    expect(first.result).toBe("confirmed");

    // Move the clock forward; a second call must NOT re-stamp
    // completed_at or re-credit the account.
    const second = await __confirmCheckoutInternal({
      sessionId: seeded.sessionId,
      db,
      now: new Date("2026-12-31T23:59:59.000Z"),
    });
    expect(second.result).toBe("already_completed");
    if (second.result !== "already_completed") throw new Error("unreachable");
    expect(second.sessionId).toBe(seeded.sessionId);
    expect(second.userId).toBe(seeded.userId);

    const accounts = await db.select("accounts", { user_id: seeded.userId });
    expect(accounts[0]!.credits).toBe(2000);

    const txns = await db.select("credit_transactions", {
      user_id: seeded.userId,
    });
    expect(txns).toHaveLength(1);

    const sessions = await db.select("checkout_sessions", {
      id: seeded.sessionId,
    });
    expect((sessions[0]!.completed_at as Date).toISOString()).toBe(
      "2026-06-29T12:00:00.000Z",
    );
  });

  it("refuses to confirm a cancelled session", async () => {
    const db = createTestDb();
    const seeded = await seedPendingCheckout(db, 100);
    // Flip status to cancelled (the only path to that state today).
    await db.update(
      "checkout_sessions",
      { id: seeded.sessionId },
      { status: "cancelled" },
    );

    await expect(
      __confirmCheckoutInternal(
        asInput({ sessionId: seeded.sessionId, db }),
      ),
    ).rejects.toThrow(/was cancelled/);

    // Account not credited.
    const accounts = await db.select("accounts", { user_id: seeded.userId });
    expect(accounts[0]!.credits).toBe(0);
    const txns = await db.select("credit_transactions", {
      user_id: seeded.userId,
    });
    expect(txns).toHaveLength(0);
  });

  it("throws for an unknown session id", async () => {
    const db = createTestDb();
    await expect(
      __confirmCheckoutInternal(asInput({ sessionId: 99999, db })),
    ).rejects.toThrow(/not found/i);
  });

  it("throws on non-positive session id", async () => {
    const db = createTestDb();
    await expect(
      __confirmCheckoutInternal(asInput({ sessionId: 0, db })),
    ).rejects.toThrow(/sessionId/);
  });

  it("throws when the session references a missing account", async () => {
    const db = createTestDb();
    const seeded = await seedPendingCheckout(db, 100);
    // Drop the account row — pathological but worth covering.
    await db.delete("accounts", { user_id: seeded.userId });
    await expect(
      __confirmCheckoutInternal(
        asInput({ sessionId: seeded.sessionId, db }),
      ),
    ).rejects.toThrow(/account not found/i);
  });
});

// ============================================================================
// Route handler tests
// ============================================================================

describe("GET /api/dev/stripe/confirm (US-016)", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetBillingProviderForTests();
    __setConfirmProductionOverride(null);
  });

  afterEach(() => {
    __setConfirmProductionOverride(null);
    __resetBillingProviderForTests();
    __resetTestDbForTests();
  });

  it("returns notFound() in production (404 surface)", async () => {
    __setConfirmProductionOverride(true);
    await expect(
      callConfirmRoute(
        new Request("http://localhost/api/dev/stripe/confirm?session=1"),
      ),
    ).rejects.toThrow();
  });

  it("runs normally when the production guard is turned off (or NODE_ENV is not 'production')", async () => {
    __setConfirmProductionOverride(false);
    const db = getTestDb();
    const seeded = await seedPendingCheckout(db, 500);

    const res = await callConfirmRoute(
      new Request(
        `http://localhost/api/dev/stripe/confirm?session=${seeded.sessionId}`,
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/app/billing");

    // The DB transitioned.
    const sessions = await db.select("checkout_sessions", {
      id: seeded.sessionId,
    });
    expect(sessions[0]!.status).toBe("completed");
    const accounts = await db.select("accounts", {
      user_id: seeded.userId,
    });
    expect(accounts[0]!.credits).toBe(500);
  });

  it("honors the ?redirect= query param when one is provided", async () => {
    __setConfirmProductionOverride(false);
    const db = getTestDb();
    const seeded = await seedPendingCheckout(db, 100);

    const res = await callConfirmRoute(
      new Request(
        `http://localhost/api/dev/stripe/confirm?session=${seeded.sessionId}&redirect=/app/billing?welcome=1`,
      ),
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/app/billing?welcome=1");
  });

  it("returns 400 when the session query param is missing", async () => {
    __setConfirmProductionOverride(false);
    const res = await callConfirmRoute(
      new Request("http://localhost/api/dev/stripe/confirm"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/session/);
  });

  it("returns 400 when session is non-numeric", async () => {
    __setConfirmProductionOverride(false);
    const res = await callConfirmRoute(
      new Request("http://localhost/api/dev/stripe/confirm?session=abc"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown session id", async () => {
    __setConfirmProductionOverride(false);
    const res = await callConfirmRoute(
      new Request("http://localhost/api/dev/stripe/confirm?session=99999"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 404 for a cancelled session", async () => {
    __setConfirmProductionOverride(false);
    const db = getTestDb();
    const seeded = await seedPendingCheckout(db, 100);
    await db.update(
      "checkout_sessions",
      { id: seeded.sessionId },
      { status: "cancelled" },
    );

    const res = await callConfirmRoute(
      new Request(
        `http://localhost/api/dev/stripe/confirm?session=${seeded.sessionId}`,
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/cancelled/i);
  });

  it("a confirmed-and-replayed request 303s without doubling credits", async () => {
    __setConfirmProductionOverride(false);
    const db = getTestDb();
    const seeded = await seedPendingCheckout(db, 2000);

    const first = await callConfirmRoute(
      new Request(
        `http://localhost/api/dev/stripe/confirm?session=${seeded.sessionId}`,
      ),
    );
    expect(first.status).toBe(303);

    const second = await callConfirmRoute(
      new Request(
        `http://localhost/api/dev/stripe/confirm?session=${seeded.sessionId}`,
      ),
    );
    expect(second.status).toBe(303);

    const accounts = await db.select("accounts", {
      user_id: seeded.userId,
    });
    expect(accounts[0]!.credits).toBe(2000);

    const txns = await db.select("credit_transactions", {
      user_id: seeded.userId,
    });
    expect(txns).toHaveLength(1);
  });
});
