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
import { __resetTestDbForTests, getTestDb, type TestDb } from "@/test/db";

/**
 * Tests for the `/admin/users` page (US-019).
 *
 * Strategy mirrors the other `/app/*` page tests:
 *   1. Reset the singleton DB and the auth override.
 *   2. Seed users + accounts.
 *   3. Set the `requireAdmin` override to either an admin (success
 *      path) or a non-admin (notFound path).
 *   4. Import the page module dynamically (`next/headers` /
 *      `requireAdmin` deps stay out of module load).
 *   5. `renderToStaticMarkup(await Page({ searchParams }))` and
 *      assert on the HTML.
 *
 * Coverage:
 *   - Admin caller renders the page header + users table.
 *   - Each row exposes email, name, credits, joined date.
 *   - Search input is pre-populated when a query is passed.
 *   - Empty state renders when no users match.
 *   - Non-admin caller triggers notFound() (assert on throw).
 *   - No cookie / no override → notFound() (admin gate bubbles the
 *     unauthenticated throw from requireUser()).
 *   - Credits render with localized formatting and `data-value`
 *     numeric attributes (matches US-017 reports pattern).
 */

// ============================================================================
// Render helper
// ============================================================================

interface PageModule {
  default: (props: {
    searchParams: Promise<{ query?: string }>;
  }) => Promise<unknown>;
}

async function renderPage(query?: string): Promise<string> {
  const mod = (await import("@/app/admin/users/page")) as unknown as PageModule;
  const element = await mod.default({
    searchParams: Promise.resolve(query ? { query } : {}),
  });
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(
  db: TestDb,
  args: {
    id: number;
    email?: string;
    name?: string;
    role?: "user" | "admin";
    createdAt?: Date;
  },
): Promise<void> {
  await db.insert("users", {
    id: args.id,
    email: args.email ?? `u${args.id}@example.com`,
    password_hash: "x",
    name: args.name ?? `User ${args.id}`,
    role: args.role ?? "user",
    created_at: args.createdAt,
  });
}

async function seedAccount(
  db: TestDb,
  userId: number,
  credits: number,
): Promise<void> {
  await db.insert("accounts", {
    user_id: userId,
    credits,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("/admin/users page (US-019)", () => {
  let db: TestDb;

  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
  });

  // ------------------------------------------------------------------------
  // Admin rendering
  // ------------------------------------------------------------------------

  it("renders the page header for an admin session", async () => {
    await seedUser(db, { id: 1, role: "admin", email: "root@x.com" });
    seedAccount(db, 1, 0);
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="admin-users-page"');
    expect(html).toContain("Users");
  });

  it("renders a row for each user with email, name, credits, joined date", async () => {
    await seedUser(db, { id: 1, role: "admin", email: "root@x.com" });
    await seedUser(db, {
      id: 2,
      email: "alice@x.com",
      name: "Alice",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });
    await seedAccount(db, 2, 1_234);

    __setCurrentUserIdForTests(1);

    const html = await renderPage();

    // Row exists with the right testids.
    expect(html).toContain('data-testid="admin-user-row-2"');
    expect(html).toContain('data-testid="admin-user-email-2"');
    expect(html).toContain("alice@x.com");
    expect(html).toContain('data-testid="admin-user-name-2"');
    expect(html).toContain("Alice");
    expect(html).toContain('data-testid="admin-user-credits-2"');
    expect(html).toContain('data-testid="admin-user-created-2"');
    expect(html).toContain("2026-06-01");

    // Credits rendered with locale formatting + data-value.
    const creditsCell = html.match(
      /data-testid="admin-user-credits-2"[^>]*data-value="(\d+)"[^>]*>([^<]+)</,
    );
    expect(creditsCell).not.toBeNull();
    expect(creditsCell![1]).toBe("1234");
    expect(creditsCell![2]).toContain("1,234");
  });

  it("shows the admin role badge on admin user rows", async () => {
    await seedUser(db, { id: 1, role: "admin", email: "root@x.com" });
    await seedUser(db, {
      id: 2,
      role: "user",
      email: "alice@x.com",
      name: "Alice",
    });

    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="admin-user-role-badge-1"');
    expect(html).toContain("admin");
    expect(html).not.toContain('data-testid="admin-user-role-badge-2"');
  });

  it("renders the search input and submit button", async () => {
    await seedUser(db, { id: 1, role: "admin" });
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="admin-users-search-form"');
    expect(html).toContain('data-testid="admin-users-search-input"');
    expect(html).toContain('name="query"');
    expect(html).toContain('data-testid="admin-users-search-button"');
    expect(html).toContain("Search");
  });

  it("pre-populates the search input when a query is passed", async () => {
    await seedUser(db, { id: 1, role: "admin" });
    await seedUser(db, { id: 2, email: "alice@x.com" });

    __setCurrentUserIdForTests(1);

    const html = await renderPage("alice");
    // The search input's `defaultValue` should be rendered into the
    // markup as the `value` attribute.
    expect(html).toMatch(
      /name="query"[^>]*value="alice"|value="alice"[^>]*name="query"/,
    );
    // Header should also reflect the query.
    expect(html).toContain("matching");
    expect(html).toContain("alice");
  });

  it("renders the empty state when no users match the query", async () => {
    await seedUser(db, { id: 1, role: "admin" });
    await seedUser(db, { id: 2, email: "alice@x.com" });

    __setCurrentUserIdForTests(1);

    const html = await renderPage("nobody-by-this-name");
    expect(html).toContain('data-testid="admin-users-empty-state"');
    expect(html).toContain("No users found");
    expect(html).toContain("nobody-by-this-name");
  });

  it("renders an adjust-credits form per row with a reason <select>", async () => {
    await seedUser(db, { id: 1, role: "admin" });
    await seedUser(db, { id: 2, email: "alice@x.com", name: "Alice" });

    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="admin-adjust-form-2"');
    expect(html).toContain('data-testid="admin-adjust-delta-2"');
    expect(html).toContain('data-testid="admin-adjust-reason-2"');
    expect(html).toContain('data-testid="admin-adjust-button-2"');

    // The reason <select> must expose every allowed reason.
    const selectStart = html.indexOf('data-testid="admin-adjust-reason-2"');
    expect(selectStart).toBeGreaterThan(-1);
    const selectEnd = html.indexOf("</select>", selectStart);
    expect(selectEnd).toBeGreaterThan(selectStart);
    const selectSlice = html.slice(selectStart, selectEnd);
    for (const reason of [
      "support",
      "refund",
      "goodwill",
      "correction",
      "chargeback",
    ]) {
      expect(selectSlice).toContain(`>${reason}<`);
    }
  });

  // ------------------------------------------------------------------------
  // Auth gating
  // ------------------------------------------------------------------------

  it("calls notFound() when the current user is a non-admin", async () => {
    await seedUser(db, { id: 1, role: "user", email: "alice@x.com" });
    __setCurrentUserIdForTests(1);

    await expect(renderPage()).rejects.toThrow();
  });

  it("calls notFound() when no user is resolved (no override)", async () => {
    __resetCurrentUserForTests();
    // No `cookies()` available in jsdom — the require-user helper
    // throws; requireAdmin bubbles that.
    await expect(renderPage()).rejects.toThrow();
  });

  it("calls notFound() when the override points at a non-existent user", async () => {
    __setCurrentUserIdForTests(999);
    await expect(renderPage()).rejects.toThrow();
  });

  // ------------------------------------------------------------------------
  // Multi-tenant safety: admin sees all users; non-admin can't reach the
  // page at all (covered above). Verify the admin view does NOT leak
  // any data the page shouldn't show — it only shows the seeded users.
  // ------------------------------------------------------------------------

  it("admin view lists every seeded user regardless of role", async () => {
    await seedUser(db, { id: 1, role: "admin", email: "root@x.com" });
    await seedUser(db, { id: 2, role: "user", email: "alice@x.com" });
    await seedUser(db, { id: 3, role: "user", email: "bob@x.com" });
    await seedAccount(db, 1, 999);
    await seedAccount(db, 2, 100);
    await seedAccount(db, 3, 0);

    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="admin-user-row-1"');
    expect(html).toContain('data-testid="admin-user-row-2"');
    expect(html).toContain('data-testid="admin-user-row-3"');
  });
});