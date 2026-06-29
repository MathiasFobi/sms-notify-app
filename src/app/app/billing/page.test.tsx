/**
 * Tests for the /app/billing page (US-016).
 *
 * Strategy mirrors the other `/app/*` page tests:
 *   1. Reset the singleton DB and the auth override.
 *   2. Seed a user + account + a handful of credit_transactions.
 *   3. Set the `requireUser` override to that user.
 *   4. Import the page module dynamically (`next/headers` /
 *      `requireUser` deps stay out of module load).
 *   5. `renderToStaticMarkup(await Page())` and assert on the HTML.
 *
 * Coverage:
 *   - Page header renders.
 *   - Balance card shows the seeded `accounts.credits` value.
 *   - All three preset packages render with the canonical credits +
 *     price values (smoke test the catalog wiring).
 *   - Purchase buttons render with the right `data-testid`s.
 *   - History table renders rows whose `reason` is in
 *     {purchase, refund, admin_adjust}.
 *   - History table omits rows whose `reason` is NOT in the allowed
 *     set (e.g. `send`).
 *   - Empty-state copy renders when the user has no qualifying
 *     transactions.
 *   - Sort order: newest first by `created_at`.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  __resetCurrentUserForTests,
  __setCurrentUserIdForTests,
} from "@/lib/auth";
import {
  __resetTestDbForTests,
  getTestDb,
  type TestDb,
} from "@/test/db";
import { PACKAGES } from "@/lib/billing/packages";

// ============================================================================
// Render helper
// ============================================================================

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/billing/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

// ============================================================================
// Fixtures
// ============================================================================

interface SeedTxnArgs {
  id: number;
  userId: number;
  delta: number;
  reason: "purchase" | "send" | "refund" | "bonus" | "admin_adjust";
  createdAt?: Date;
}

async function seedTxn(db: TestDb, args: SeedTxnArgs): Promise<number> {
  const inserted = await db.insert("credit_transactions", {
    id: args.id,
    user_id: args.userId,
    delta: args.delta,
    reason: args.reason,
    created_at: args.createdAt,
  });
  return inserted.id as number;
}

// ============================================================================
// Tests
// ============================================================================

describe("/app/billing page (US-016)", () => {
  let db: TestDb;

  beforeEach(async () => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
    await db.insert("users", {
      id: 1,
      email: "alice@example.com",
      password_hash: "x",
      name: "Alice",
    });
    // Seed an account row so the balance section has a number to
    // render. Credits intentionally non-zero so we can prove the
    // balance is read from the row.
    await db.insert("accounts", {
      user_id: 1,
      credits: 42,
      plan: "free",
    });
    __setCurrentUserIdForTests(1);
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header", async () => {
    const html = await renderPage();
    expect(html).toContain("Billing");
    expect(html).toMatch(/Top up your credit balance/);
  });

  it("renders the balance card with the seeded accounts.credits value", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="billing-balance"');
    // The balance value is formatted via toLocaleString() — small
    // integers render as "42".
    expect(html).toContain('data-testid="billing-balance-value"');
    expect(html).toContain("42");
    expect(html).toMatch(/credits/);
  });

  it("falls back to a 0 balance when the user has no account row yet", async () => {
    // Drop the account and confirm the page still renders a balance
    // without crashing.
    await db.delete("accounts", { user_id: 1 });
    const html = await renderPage();
    expect(html).toContain('data-testid="billing-balance-value"');
    expect(html).toContain("0");
  });

  it("renders one card per entry in PACKAGES with the canonical credits + price", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="billing-packages"');

    for (const pkg of PACKAGES) {
      // The package card carries a data-testid of
      // `billing-package-${id}` plus data-package-credits and
      // data-price-usd-cents.
      expect(html).toContain(
        `data-testid="billing-package-${pkg.id}"`,
      );
      expect(html).toContain(
        `data-package-credits="${pkg.credits}"`,
      );
      expect(html).toContain(
        `data-price-usd-cents="${pkg.priceUsdCents}"`,
      );
      // Formatted price appears at least once on the page.
      expect(html).toContain(`$${(pkg.priceUsdCents / 100).toFixed(2)}`);
    }
  });

  it("renders a purchase button per package", async () => {
    const html = await renderPage();
    for (const pkg of PACKAGES) {
      expect(html).toContain(
        `data-testid="billing-purchase-${pkg.credits}"`,
      );
    }
  });

  it("renders the empty-state copy when the user has no qualifying transactions", async () => {
    const html = await renderPage();
    expect(html).toContain('data-testid="billing-history"');
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain("No purchases yet");
  });

  it("renders the history table with purchase rows", async () => {
    const id = await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: 500,
      reason: "purchase",
      createdAt: new Date("2026-06-29T08:00:00.000Z"),
    });
    const html = await renderPage();
    expect(html).toContain("<table");
    expect(html).toContain('data-testid="billing-history"');
    expect(html).toContain(`data-testid="billing-history-row-${id}"`);
    expect(html).toContain(`data-testid="billing-history-delta-${id}"`);
    expect(html).toContain('data-delta="500"');
    // The reason column renders a human-readable label.
    expect(html).toContain("Purchase");
  });

  it("includes refund and admin_adjust rows in the history", async () => {
    const refundId = await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -50,
      reason: "refund",
      createdAt: new Date("2026-06-29T08:00:00.000Z"),
    });
    const adminId = await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 25,
      reason: "admin_adjust",
      createdAt: new Date("2026-06-29T09:00:00.000Z"),
    });

    const html = await renderPage();
    expect(html).toContain(`data-testid="billing-history-row-${refundId}"`);
    expect(html).toContain(`data-testid="billing-history-row-${adminId}"`);
    expect(html).toContain("Refund");
    expect(html).toContain("Admin adjustment");
  });

  it("excludes send + bonus rows from the history (only purchase/refund/admin_adjust count)", async () => {
    // Send debit (negative) and bonus credit (positive) should be
    // hidden. Only purchases / refunds / admin_adjust are billed.
    const sendId = await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: -1,
      reason: "send",
      createdAt: new Date("2026-06-29T08:00:00.000Z"),
    });
    const bonusId = await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 10,
      reason: "bonus",
      createdAt: new Date("2026-06-29T08:30:00.000Z"),
    });

    const html = await renderPage();

    expect(html).not.toContain(`data-testid="billing-history-row-${sendId}"`);
    expect(html).not.toContain(`data-testid="billing-history-row-${bonusId}"`);
    // No rows in the table body either.
    expect(html).toContain('data-testid="empty-state"');
  });

  it("sorts the history newest-first by created_at", async () => {
    const olderId = await seedTxn(db, {
      id: 1,
      userId: 1,
      delta: 100,
      reason: "purchase",
      createdAt: new Date("2026-06-29T07:00:00.000Z"),
    });
    const newerId = await seedTxn(db, {
      id: 2,
      userId: 1,
      delta: 200,
      reason: "purchase",
      createdAt: new Date("2026-06-29T10:00:00.000Z"),
    });

    const html = await renderPage();
    const newerIdx = html.indexOf(`data-testid="billing-history-row-${newerId}"`);
    const olderIdx = html.indexOf(`data-testid="billing-history-row-${olderId}"`);
    expect(newerIdx).toBeGreaterThan(-1);
    expect(olderIdx).toBeGreaterThan(-1);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it("does not leak another user's transactions", async () => {
    // Seed a second user + a couple of their own transactions; the
    // page must NOT render them.
    await db.insert("users", {
      id: 2,
      email: "bob@example.com",
      password_hash: "x",
      name: "Bob",
    });
    await db.insert("accounts", {
      user_id: 2,
      credits: 0,
      plan: "free",
    });
    const bobId = await seedTxn(db, {
      id: 99,
      userId: 2,
      delta: 999,
      reason: "purchase",
      createdAt: new Date("2026-06-29T08:00:00.000Z"),
    });
    const aliceId = await seedTxn(db, {
      id: 100,
      userId: 1,
      delta: 5,
      reason: "purchase",
      createdAt: new Date("2026-06-29T08:30:00.000Z"),
    });

    const html = await renderPage();
    expect(html).toContain(`data-testid="billing-history-row-${aliceId}"`);
    expect(html).not.toContain(`data-testid="billing-history-row-${bobId}"`);
    // Also: bob's 999 delta should not appear on the page.
    expect(html).not.toContain('data-delta="999"');
  });
});
