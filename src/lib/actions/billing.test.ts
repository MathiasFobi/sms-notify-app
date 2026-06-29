/**
 * Tests for `src/lib/actions/billing.ts` (US-016).
 *
 * Coverage:
 *
 *   1. `__startCheckoutInternal()` — given a fresh `createTestDb()`
 *      and a `MockStripeProvider` constructed against it:
 *        - Inserts a `checkout_sessions` row with `status='pending'`.
 *        - Returns a URL containing the confirm endpoint
 *          (`/api/dev/stripe/confirm?session=<id>`).
 *        - Returns the inserted row's primary key as `sessionId`.
 *        - Throws on unknown `packageCredits`.
 *        - Throws on non-positive `userId` / `packageCredits`.
 *
 *   2. `startCheckoutAction()` — the public wrapper is exercised
 *      via the `__setCurrentUserIdForTests` seam (no live cookie
 *      plumbing). It should resolve the user from the cookie seam,
 *      call the internal, and return its result.
 *
 * The public action imports `getBillingProvider()` and
 * `requireUser()`. We exercise the public action with the
 * `__setCurrentUserIdForTests` + `__resetBillingProviderForTests`
 * seams so the singleton uses a fresh `MockStripeProvider`
 * constructed against the singleton `getTestDb()`. The internal
 * tests use a freshly-injected db + provider so they don't depend
 * on the singleton at all.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import {
  __resetBillingProviderForTests,
  MockStripeProvider,
} from "@/lib/billing";
import {
  __startCheckoutInternal,
  startCheckoutAction,
  type StartCheckoutInput,
} from "@/lib/actions/billing";
import {
  PACKAGES,
  getPackageById,
} from "@/lib/billing/packages";
import {
  __resetTestDbForTests,
  createTestDb,
  getTestDb,
  type TestDb,
} from "@/test/db";

// ============================================================================
// Fixtures
// ============================================================================

interface Seeded {
  db: TestDb;
  userId: number;
}

/** Seed a user into a fresh DB and return its id. */
async function seedUser(db: TestDb): Promise<number> {
  const u = await db.insert("users", {
    email: "alice@example.com",
    password_hash: "x",
    name: "Alice",
  });
  return u.id as number;
}

// ============================================================================
// Internal action tests (hermetic — fresh db + provider per test)
// ============================================================================

describe("__startCheckoutInternal (US-016)", () => {
  it("inserts a checkout_sessions row with status='pending'", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);

    const input: StartCheckoutInput = {
      userId,
      packageCredits: 500,
      db,
      provider,
    };
    const result = await __startCheckoutInternal(input);

    const rows = await db.select("checkout_sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result.sessionId);
    expect(rows[0]!.user_id).toBe(userId);
    expect(rows[0]!.package_credits).toBe(500);
    expect(rows[0]!.price_usd_cents).toBe(2000);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.completed_at).toBeUndefined();
  });

  it("returns a URL containing /api/dev/stripe/confirm?session=<id>", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);

    const result = await __startCheckoutInternal({
      userId,
      packageCredits: 100,
      db,
      provider,
    });

    expect(result.url).toMatch(/^\/api\/dev\/stripe\/confirm\?session=\d+$/);
    expect(result.url).toContain(
      `/api/dev/stripe/confirm?session=${result.sessionId}`,
    );
  });

  it("uses the package priceUsdCents from the catalog", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);

    // Walk the catalog so the test stays in sync if any package
    // is re-priced.
    for (const pkg of PACKAGES) {
      const result = await __startCheckoutInternal({
        userId,
        packageCredits: pkg.credits,
        db,
        provider,
      });
      const rows = await db.select("checkout_sessions", { id: result.sessionId });
      expect(rows[0]!.price_usd_cents).toBe(pkg.priceUsdCents);
      expect(rows[0]!.package_credits).toBe(pkg.credits);
    }
  });

  it("returns the inserted row's primary key as sessionId", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);

    const { sessionId, url } = await __startCheckoutInternal({
      userId,
      packageCredits: 2000,
      db,
      provider,
    });

    expect(sessionId).toBe(1); // first insert into an empty DB
    // url embeds the same id.
    expect(url).toContain(`session=${sessionId}`);
  });

  it("throws on unknown packageCredits (no catalog entry matches)", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);

    await expect(
      __startCheckoutInternal({
        userId,
        packageCredits: 9999,
        db,
        provider,
      }),
    ).rejects.toThrow(/unknown packageCredits 9999/);

    // No row was inserted.
    const rows = await db.select("checkout_sessions");
    expect(rows).toHaveLength(0);
  });

  it("throws on non-positive userId", async () => {
    const db = createTestDb();
    const provider = new MockStripeProvider(db);
    await expect(
      __startCheckoutInternal({
        userId: -1,
        packageCredits: 100,
        db,
        provider,
      }),
    ).rejects.toThrow(/userId/);
  });

  it("throws on non-positive packageCredits", async () => {
    const db = createTestDb();
    const userId = await seedUser(db);
    const provider = new MockStripeProvider(db);
    await expect(
      __startCheckoutInternal({
        userId,
        packageCredits: 0,
        db,
        provider,
      }),
    ).rejects.toThrow(/packageCredits/);
  });

  it("is hermetic — does not write to the singleton db", async () => {
    const localDb = createTestDb();
    const userId = await seedUser(localDb);
    const provider = new MockStripeProvider(localDb);

    await __startCheckoutInternal({
      userId,
      packageCredits: 500,
      db: localDb,
      provider,
    });

    const singleton = getTestDb();
    expect(singleton).not.toBe(localDb);
    const rows = await singleton.select("checkout_sessions");
    expect(rows).toHaveLength(0);
  });
});

// ============================================================================
// Public action tests (singleton paths; uses requireUser override)
// ============================================================================

describe("startCheckoutAction (public wrapper)", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetBillingProviderForTests();
    __resetCurrentUserForTests();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetBillingProviderForTests();
    __resetTestDbForTests();
  });

  it("uses requireUser() to scope the checkout session to the current user", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 42,
      email: "scoped@example.com",
      password_hash: "x",
      name: "Scoped",
    });
    __setCurrentUserIdForTests(42);

    const result = await startCheckoutAction({ packageCredits: 100 });

    const rows = await db.select("checkout_sessions", {
      id: result.sessionId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(42);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.package_credits).toBe(100);
    expect(rows[0]!.price_usd_cents).toBe(500);
    expect(result.url).toContain(`/api/dev/stripe/confirm?session=${result.sessionId}`);
  });

  it("throws when there is no current user (requireUser not satisfied)", async () => {
    // No cookie, no override — requireUser() should throw. The exact
    // message comes from either `requireUser` (when our override is
    // unset but the test runner has no cookie context) or from the
    // `next/headers` runtime. Both are acceptable — what matters
    // here is that the action refuses to run without an auth seam.
    await expect(
      startCheckoutAction({ packageCredits: 100 }),
    ).rejects.toThrow();
  });

  it("propagates the unknown-package error from the internal helper", async () => {
    const db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "x@example.com",
      password_hash: "x",
      name: "x",
    });
    __setCurrentUserIdForTests(1);

    await expect(
      startCheckoutAction({ packageCredits: 12_345 }),
    ).rejects.toThrow(/unknown packageCredits/);

    const rows = await db.select("checkout_sessions");
    expect(rows).toHaveLength(0);
  });
});

// ============================================================================
// getPackageById (re-export sanity check)
// ============================================================================

describe("getPackageById() — cross-check via the action's import path", () => {
  it("resolves every catalog entry by its id", () => {
    for (const pkg of PACKAGES) {
      const found = getPackageById(pkg.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(pkg.id);
    }
  });
});
