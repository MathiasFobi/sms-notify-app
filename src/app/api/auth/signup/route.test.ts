import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { users, accounts } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { createTestDb } from "@/test/db";
import { hashPassword } from "@/lib/password";

/**
 * US-002 /api/auth/signup route tests.
 *
 * The route imports `signIn` from `@/auth` (which pulls in the
 * DrizzleAdapter and NextAuth's full config). We mock that module
 * so the route runs in isolation — we're testing the route's
 * behavior, not NextAuth's.
 *
 * The `db` module is also mocked: the route imports `db` from
 * `@/db`, which uses the real postgres-js client. We swap it for
 * a PGlite in-memory instance (one per test) and then call the
 * route handler with a constructed `Request`.
 *
 * Why both mocks? `vi.mock()` runs at module-load time, so the
 * mocked `db` is captured by the closure that the route uses.
 * The `beforeEach` block re-creates the PGlite DB and reassigns
 * the mocked `db.getDb()` getter so each test sees a clean slate.
 */

let T: Awaited<ReturnType<typeof createTestDb>>;
const testState: { dbRef: TestDb | null } = { dbRef: null };

vi.mock("@/db", () => ({
  get db() {
    return testState.dbRef!;
  },
}));

vi.mock("@/auth", () => ({
  signIn: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => undefined),
  auth: vi.fn(async () => null),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  unstable_update: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

beforeEach(async () => {
  T = await createTestDb();
  testState.dbRef = T.db;
});

afterEach(async () => {
  try {
    await T.close();
  } catch {
    // already closed
  }
  testState.dbRef = null;
  vi.clearAllMocks();
});

describe("POST /api/auth/signup", () => {
  it("creates a user + account, returns 201 with ok:true", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "correct-horse-battery",
        name: "Alice",
      }),
    });
    const r = await POST(req);
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.email).toBe("alice@example.com");

    // The user row exists, has a bcrypt hash, and is "verified"
    const [u] = await T.db
      .select()
      .from(users)
      .where(eq(users.email, "alice@example.com"));
    expect(u).toBeDefined();
    expect(u!.name).toBe("Alice");
    expect(u!.passwordHash).toMatch(/^\$2b\$10\$/);
    expect(u!.emailVerified).toBeInstanceOf(Date);

    // The paired billing `accounts` row exists
    const [a] = await T.db
      .select()
      .from(accounts)
      .where(eq(accounts.userId, u!.id));
    expect(a).toBeDefined();
    expect(a!.credits).toBe(0);
    expect(a!.plan).toBe("free");
  });

  it("returns 409 'Email already registered' on duplicate", async () => {
    // Seed a user manually
    const passwordHash = await hashPassword("existing-password-1");
    await T.db.insert(users).values({
      email: "bob@example.com",
      name: "Bob",
      passwordHash,
      emailVerified: new Date(),
    });

    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "another-password-1",
        name: "Bob 2",
      }),
    });
    const r = await POST(req);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("Email already registered");
  });

  it("returns 400 when password is < 8 chars", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "carol@example.com",
        password: "short",
        name: "Carol",
      }),
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error).toBe("ValidationError");
    expect(j.issues.some((i: { path: string }) => i.path === "password")).toBe(
      true,
    );
  });

  it("returns 400 on missing fields", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "dave@example.com" }),
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
  });

  it("returns 400 on invalid JSON", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const r = await POST(req);
    expect(r.status).toBe(400);
  });

  it("normalizes email to lowercase", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "Eve@Example.COM",
        password: "good-password-1",
        name: "Eve",
      }),
    });
    expect((await POST(req)).status).toBe(201);
    const [row] = await T.db
      .select()
      .from(users)
      .where(eq(users.email, "eve@example.com"));
    expect(row).toBeDefined();
  });

  it("returns 400 on invalid email format", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const req = new Request("http://localhost:3000/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "good-password-1",
        name: "Frank",
      }),
    });
    expect((await POST(req)).status).toBe(400);
  });
});
