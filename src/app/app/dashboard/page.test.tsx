/**
 * Tests for the /app/dashboard page (US-020).
 *
 * Strategy mirrors the other `/app/*` page tests:
 *   1. Reset the singleton DB + auth override.
 *   2. Seed a user + inbound + messages rows.
 *   3. Set the `requireUser` override to that user.
 *   4. Import the page module dynamically so `next/headers` /
 *      `requireUser` deps stay out of module load.
 *   5. `renderToStaticMarkup(await Page())` and assert on the HTML.
 *
 * Coverage:
 *   - Page header renders.
 *   - Stat cards render with their values.
 *   - Empty recent activity renders the EmptyState.
 *   - When inbound + outbound rows exist, the chart contains bars
 *     with `data-date` + `data-count`, and the activity table
 *     renders rows with `data-testid="dashboard-activity-row-..."`.
 *   - Multi-tenant isolation: a second user's messages do NOT
 *     appear in the user's chart or activity feed.
 *   - The volume chart's bar count equals
 *     `DASHBOARD_VOLUME_DAYS` (30) even when the user has no
 *     activity.
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
import { __resetTestDbForTests, getTestDb, type TestDb } from "@/test/db";
import { DASHBOARD_VOLUME_DAYS } from "@/lib/dashboard";

// ============================================================================
// Render helper
// ============================================================================

interface PageModule {
  default: () => Promise<unknown>;
}

async function renderPage(): Promise<string> {
  const mod = (await import("@/app/app/dashboard/page")) as unknown as PageModule;
  const element = await mod.default();
  return renderToStaticMarkup(
    element as Parameters<typeof renderToStaticMarkup>[0],
  );
}

// ============================================================================
// Fixtures
// ============================================================================

async function seedUser(db: TestDb, id: number): Promise<void> {
  await db.insert("users", {
    id,
    email: `u${id}@example.com`,
    password_hash: "x",
    name: `User ${id}`,
  });
}

interface SeedMessageArgs {
  id: number;
  userId: number;
  body?: string;
  fromNumber?: string;
  status?: string;
  createdAt?: Date;
}

async function seedMessage(
  db: TestDb,
  args: SeedMessageArgs,
): Promise<void> {
  await db.insert("messages", {
    id: args.id,
    user_id: args.userId,
    body: args.body ?? `body-${args.id}`,
    from_number: args.fromNumber ?? "+15555550100",
    status: args.status ?? "sent",
    created_at: args.createdAt ?? new Date(),
  });
}

interface SeedInboundArgs {
  id: number;
  userId: number;
  fromPhone?: string;
  body?: string;
  createdAt?: Date;
  read?: boolean;
}

async function seedInbound(
  db: TestDb,
  args: SeedInboundArgs,
): Promise<void> {
  await db.insert("inbound_messages", {
    id: args.id,
    user_id: args.userId,
    from_phone: args.fromPhone ?? `+1555555019${args.id % 10}`,
    to_number: "+15555550199",
    body: args.body ?? `in-${args.id}`,
    twilio_message_sid: `IM${args.id}`,
    received_at: args.createdAt ?? new Date(),
    read: args.read ?? false,
    created_at: args.createdAt ?? new Date(),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe("/app/dashboard page (US-020)", () => {
  let db: TestDb;

  beforeEach(() => {
    __resetTestDbForTests();
    __resetCurrentUserForTests();
    db = getTestDb();
  });

  afterEach(() => {
    __resetCurrentUserForTests();
    __resetTestDbForTests();
  });

  it("renders the page header", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    // The header should be either "Welcome back, {name}" or a
    // generic "Dashboard" — depending on whether the seeded user
    // has a `name` set. We assert on the sub-headline copy which
    // is stable across both render paths.
    expect(html).toMatch(/quick look at your messaging activity/);
  });

  it("renders both stat cards with zero values when empty", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="dashboard-stat-unread"');
    expect(html).toContain('data-testid="dashboard-stat-volume"');
    expect(html).toContain('data-testid="dashboard-unread-value" data-value="0"');
    expect(html).toContain('data-testid="dashboard-volume-total" data-value="0"');
  });

  it("renders the volume chart with 30 bars even when empty", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="dashboard-volume-chart"');
    const barMatches = html.match(
      /data-testid="dashboard-volume-bar-\d{4}-\d{2}-\d{2}"/g,
    );
    expect(barMatches).not.toBeNull();
    expect(barMatches).toHaveLength(DASHBOARD_VOLUME_DAYS);
  });

  it("renders the empty state inside the recent activity section when nothing has happened", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const html = await renderPage();
    expect(html).toContain('data-testid="dashboard-activity-section"');
    expect(html).toContain("No recent activity");
  });

  it("renders the chart with counts when the user has recent messages", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const today = new Date("2026-06-29T10:00:00.000Z");
    const yesterday = new Date("2026-06-28T10:00:00.000Z");
    await seedMessage(db, { id: 1, userId: 1, createdAt: today });
    await seedMessage(db, { id: 2, userId: 1, createdAt: today });
    await seedMessage(db, { id: 3, userId: 1, createdAt: yesterday });

    const html = await renderPage();
    // Volume total should be 3.
    expect(html).toContain('data-testid="dashboard-volume-total" data-value="3"');
    // Today bar should show count=2.
    expect(html).toContain('data-date="2026-06-29" data-count="2"');
    // Yesterday bar should show count=1.
    expect(html).toContain('data-date="2026-06-28" data-count="1"');
  });

  it("renders the activity table when there are outbound + inbound rows", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    const t1 = new Date("2026-06-29T12:00:00.000Z");
    const t2 = new Date("2026-06-29T11:00:00.000Z");
    const t3 = new Date("2026-06-29T10:00:00.000Z");
    await seedMessage(db, {
      id: 10,
      userId: 1,
      body: "Hello there",
      createdAt: t1,
    });
    await seedInbound(db, {
      id: 20,
      userId: 1,
      body: "Hi back",
      createdAt: t2,
    });
    await seedMessage(db, {
      id: 11,
      userId: 1,
      body: "Earlier send",
      createdAt: t3,
    });

    const html = await renderPage();
    expect(html).toContain(
      'data-testid="dashboard-activity-row-outbound-10"',
    );
    expect(html).toContain(
      'data-testid="dashboard-activity-row-inbound-20"',
    );
    expect(html).toContain(
      'data-testid="dashboard-activity-row-outbound-11"',
    );
    expect(html).toContain("Hello there");
    expect(html).toContain("Hi back");
    expect(html).toContain("Earlier send");
  });

  it("does not leak another user's messages into the chart or activity feed", async () => {
    await seedUser(db, 1);
    await seedUser(db, 2);
    __setCurrentUserIdForTests(1);

    const today = new Date("2026-06-29T10:00:00.000Z");
    await seedMessage(db, { id: 1, userId: 1, createdAt: today });
    // User 2 — should NOT show up for user 1.
    await seedMessage(db, { id: 2, userId: 2, createdAt: today });
    await seedInbound(db, { id: 1, userId: 2, body: "private" });

    const html = await renderPage();
    expect(html).toContain('data-testid="dashboard-volume-total" data-value="1"');
    // No inbound row for user 1.
    expect(html).not.toContain(
      'data-testid="dashboard-activity-row-inbound-1"',
    );
    // User 1's outbound (id=1) is present; user 2's outbound (id=2) is NOT.
    expect(html).toContain(
      'data-testid="dashboard-activity-row-outbound-1"',
    );
    expect(html).not.toContain(
      'data-testid="dashboard-activity-row-outbound-2"',
    );
    expect(html).not.toContain("private");
  });

  it("unread stat reflects unread inbound_messages", async () => {
    await seedUser(db, 1);
    __setCurrentUserIdForTests(1);

    await seedInbound(db, {
      id: 1,
      userId: 1,
      read: false,
    });
    await seedInbound(db, {
      id: 2,
      userId: 1,
      read: false,
    });
    await seedInbound(db, {
      id: 3,
      userId: 1,
      read: true,
    });

    const html = await renderPage();
    expect(html).toContain('data-testid="dashboard-unread-value" data-value="2"');
  });
});
