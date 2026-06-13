import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * US-002 requireUser() guard test.
 *
 * `requireUser()` is a tiny server helper that wraps `auth()`.
 * When the session is null it calls `redirect("/login?...")`.
 * The redirect is implemented with `next/navigation`'s
 * `redirect()` which throws a special error that Next's render
 * loop catches and turns into an HTTP 302.
 *
 * To test the redirect without spinning up a Next.js server we
 * mock `next/navigation` and assert the redirect was called.
 */

const authMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  // Mirror Next's actual behavior: redirect() throws.
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
  throw err;
});

vi.mock("@/auth", () => ({
  auth: authMock,
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  unstable_update: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

afterEach(() => {
  authMock.mockReset();
  redirectMock.mockReset();
  // Re-attach the throwing implementation, since `mockReset`
  // strips both the implementation and the call history.
  redirectMock.mockImplementation((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
    throw err;
  });
});

describe("requireUser() (US-002)", () => {
  it("returns the session user when one exists", async () => {
    authMock.mockResolvedValueOnce({
      user: { id: "42", name: "Alice", email: "alice@example.com", role: "user" },
    });

    // Dynamic import inside the test so the mocks are wired first.
    const { requireUser } = await import("@/lib/auth");
    const u = await requireUser();
    expect(u.id).toBe("42");
    expect(u.name).toBe("Alice");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("throws (NEXT_REDIRECT) to /login when no session", async () => {
    authMock.mockResolvedValueOnce(null);

    const { requireUser } = await import("@/lib/auth");
    await expect(requireUser()).rejects.toThrow(/NEXT_REDIRECT.*\/login/);
    expect(redirectMock).toHaveBeenCalledTimes(1);
    const url = redirectMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("/login");
    // The callbackUrl is preserved so the user lands back at the
    // dashboard after they sign in.
    expect(url).toContain("callbackUrl");
  });

  it("throws (NEXT_REDIRECT) to /login when session has no user", async () => {
    authMock.mockResolvedValueOnce({ user: null });

    const { requireUser } = await import("@/lib/auth");
    await expect(requireUser()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirectMock).toHaveBeenCalledTimes(1);
  });
});
