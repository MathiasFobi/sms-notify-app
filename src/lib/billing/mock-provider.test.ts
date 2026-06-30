import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetBillingProviderForTests,
  getBillingProvider,
  MockStripeProvider,
} from "@/lib/billing";
import { __resetTestDbForTests, __truncateTestDbForTests, getTestDb } from "@/test/db";

describe("MockStripeProvider", () => {
  beforeEach(() => {
    __resetTestDbForTests();
    __resetBillingProviderForTests();
  });

  afterEach(() => {
    __resetBillingProviderForTests();
    __resetTestDbForTests();
  });

  describe("createCheckoutSession()", () => {
    it("returns a URL containing /api/dev/stripe/confirm?session=", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const result = await provider.createCheckoutSession({
        userId: 1,
        packageCredits: 1000,
        priceUsdCents: 4900,
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      expect(result.url).toMatch(/^\/api\/dev\/stripe\/confirm\?session=\d+$/);
      expect(result.url).toContain(
        `/api/dev/stripe/confirm?session=${result.id}`,
      );
    });

    it("returns a stripeSessionId with the mock_cs_ prefix", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const result = await provider.createCheckoutSession({
        userId: 1,
        packageCredits: 1000,
        priceUsdCents: 4900,
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      expect(result.stripeSessionId).toMatch(/^mock_cs_[0-9a-f-]{36}$/);
    });

    it("inserts a row into checkout_sessions with status='pending'", async () => {
      const db = getTestDb();
      const provider = new MockStripeProvider(db);

      const before = await db.select("checkout_sessions");
      expect(before).toHaveLength(0);

      const result = await provider.createCheckoutSession({
        userId: 42,
        packageCredits: 5000,
        priceUsdCents: 19900,
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      const after = await db.select("checkout_sessions");
      expect(after).toHaveLength(1);

      const row = after[0];
      expect(row.id).toBe(result.id);
      expect(row.user_id).toBe(42);
      expect(row.stripe_session_id).toBe(result.stripeSessionId);
      expect(row.package_credits).toBe(5000);
      expect(row.price_usd_cents).toBe(19900);
      expect(row.status).toBe("pending");
      // completed_at should NOT be set on a fresh pending row.
      expect(row.completed_at).toBeUndefined();
      // created_at should be a Date (or string-coercible to one).
      expect(row.created_at).toBeDefined();
    });

    it("rejects invalid inputs with a thrown error", async () => {
      const provider = new MockStripeProvider(getTestDb());

      // @ts-expect-error — intentionally invalid
      await expect(provider.createCheckoutSession(null)).rejects.toThrow(
        /input is required/,
      );

      await expect(
        provider.createCheckoutSession({
          userId: -1,
          packageCredits: 1000,
          priceUsdCents: 4900,
          successUrl: "x",
          cancelUrl: "y",
        }),
      ).rejects.toThrow(/userId/);

      await expect(
        provider.createCheckoutSession({
          userId: 1,
          packageCredits: 0,
          priceUsdCents: 4900,
          successUrl: "x",
          cancelUrl: "y",
        }),
      ).rejects.toThrow(/packageCredits/);

      await expect(
        provider.createCheckoutSession({
          userId: 1,
          packageCredits: 1000,
          priceUsdCents: "free" as unknown as number,
          successUrl: "x",
          cancelUrl: "y",
        }),
      ).rejects.toThrow(/priceUsdCents/);

      await expect(
        provider.createCheckoutSession({
          userId: 1,
          packageCredits: 1000,
          priceUsdCents: 4900,
          successUrl: "",
          cancelUrl: "y",
        }),
      ).rejects.toThrow(/successUrl/);

      await expect(
        provider.createCheckoutSession({
          userId: 1,
          packageCredits: 1000,
          priceUsdCents: 4900,
          successUrl: "x",
          cancelUrl: undefined as unknown as string,
        }),
      ).rejects.toThrow(/cancelUrl/);
    });
  });

  describe("handleWebhook()", () => {
    it("flips the row to 'completed' and stamps completedAt", async () => {
      const db = getTestDb();
      const provider = new MockStripeProvider(db);

      const created = await provider.createCheckoutSession({
        userId: 7,
        packageCredits: 1000,
        priceUsdCents: 4900,
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      });

      // Sanity: pending at this point.
      const before = await db.select("checkout_sessions", { id: created.id });
      expect(before[0].status).toBe("pending");
      expect(before[0].completed_at).toBeUndefined();

      const ok = await provider.handleWebhook(
        JSON.stringify({ stripeSessionId: created.stripeSessionId }),
        "mock-signature",
      );
      expect(ok).toBe(true);

      const after = await db.select("checkout_sessions", { id: created.id });
      expect(after).toHaveLength(1);
      expect(after[0].status).toBe("completed");
      expect(after[0].completed_at).toBeDefined();
      // completed_at should be a Date instance (the in-memory DB stores it as-is).
      expect(after[0].completed_at).toBeInstanceOf(Date);
    });

    it("returns false when the session id is unknown", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const ok = await provider.handleWebhook(
        JSON.stringify({ stripeSessionId: "mock_cs_does-not-exist" }),
        "mock-signature",
      );
      expect(ok).toBe(false);
    });

    it("returns false when the body is not valid JSON", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const ok = await provider.handleWebhook("not-json", "mock-signature");
      expect(ok).toBe(false);
    });

    it("returns false when the body is missing stripeSessionId", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const ok = await provider.handleWebhook(
        JSON.stringify({ type: "checkout.session.completed" }),
        "mock-signature",
      );
      expect(ok).toBe(false);
    });

    it("is idempotent — calling handleWebhook twice does not re-stamp completedAt", async () => {
      const db = getTestDb();
      const provider = new MockStripeProvider(db);

      const created = await provider.createCheckoutSession({
        userId: 1,
        packageCredits: 1000,
        priceUsdCents: 4900,
        successUrl: "x",
        cancelUrl: "y",
      });

      await provider.handleWebhook(
        JSON.stringify({ stripeSessionId: created.stripeSessionId }),
        "sig",
      );
      const first = (await db.select("checkout_sessions", { id: created.id }))[0]
        .completed_at as Date;

      // Tiny wait so a fresh Date would differ — proves the second call
      // didn't bump completed_at.
      await new Promise((r) => setTimeout(r, 5));

      const ok = await provider.handleWebhook(
        JSON.stringify({ stripeSessionId: created.stripeSessionId }),
        "sig",
      );
      expect(ok).toBe(true);

      const second = (await db.select("checkout_sessions", { id: created.id }))[0]
        .completed_at as Date;
      expect(second.getTime()).toBe(first.getTime());
    });
  });

  describe("getSessionById() (test helper)", () => {
    it("returns the row matching the id", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const created = await provider.createCheckoutSession({
        userId: 99,
        packageCredits: 250,
        priceUsdCents: 1200,
        successUrl: "x",
        cancelUrl: "y",
      });

      const fetched = await provider.getSessionById(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.userId).toBe(99);
      expect(fetched!.stripeSessionId).toBe(created.stripeSessionId);
      expect(fetched!.status).toBe("pending");
    });

    it("returns null for an unknown id", async () => {
      const provider = new MockStripeProvider(getTestDb());
      const fetched = await provider.getSessionById(99999);
      expect(fetched).toBeNull();
    });
  });
});

describe("getBillingProvider()", () => {
  beforeEach(() => {
    __resetBillingProviderForTests();
  });

  afterEach(() => {
    __resetBillingProviderForTests();
  });

  it("returns a MockStripeProvider by default", () => {
    const original = process.env.BILLING_PROVIDER;
    delete process.env.BILLING_PROVIDER;

    try {
      const provider = getBillingProvider();
      expect(provider).toBeInstanceOf(MockStripeProvider);
    } finally {
      if (original !== undefined) process.env.BILLING_PROVIDER = original;
    }
  });

  it("returns the same singleton instance on repeated calls", () => {
    const original = process.env.BILLING_PROVIDER;
    delete process.env.BILLING_PROVIDER;

    try {
      const a = getBillingProvider();
      const b = getBillingProvider();
      expect(a).toBe(b);
    } finally {
      if (original !== undefined) process.env.BILLING_PROVIDER = original;
    }
  });

  it("throws when BILLING_PROVIDER=stripe (not implemented yet)", () => {
    const original = process.env.BILLING_PROVIDER;
    process.env.BILLING_PROVIDER = "stripe";

    try {
      expect(() => getBillingProvider()).toThrow(/not implemented/i);
    } finally {
      if (original === undefined) delete process.env.BILLING_PROVIDER;
      else process.env.BILLING_PROVIDER = original;
    }
  });

  it("__resetBillingProviderForTests() yields a fresh instance", () => {
    const original = process.env.BILLING_PROVIDER;
    delete process.env.BILLING_PROVIDER;

    try {
      const a = getBillingProvider();
      __resetBillingProviderForTests();
      const b = getBillingProvider();
      expect(a).not.toBe(b);
    } finally {
      if (original !== undefined) process.env.BILLING_PROVIDER = original;
    }
  });
});

// Smoke test that the test DB factory itself is wired correctly — if this
// breaks, every other test in this file is suspect.
describe("getTestDb() (smoke)", () => {
  afterEach(() => {
    __resetTestDbForTests();
  });

  it("returns the same singleton across calls", () => {
    const a = getTestDb();
    const b = getTestDb();
    expect(a).toBe(b);
  });

  it("starts empty across all tables", () => {
    const db = getTestDb();
    expect(db.tables.users.rows).toHaveLength(0);
    expect(db.tables.checkout_sessions.rows).toHaveLength(0);
  });

  it("__truncateTestDbForTests() empties the DB without discarding it", () => {
    const db = getTestDb();
    db.insert("checkout_sessions", { stripe_session_id: "x", status: "pending" });
    expect(db.tables.checkout_sessions.rows.length).toBe(1);

    __truncateTestDbForTests();
    expect(db.tables.checkout_sessions.rows.length).toBe(0);
    // The DB itself should be the same object.
    expect(getTestDb()).toBe(db);
  });
});