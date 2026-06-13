import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * US-003 signOutAction() server-action test.
 *
 * The action lives at src/app/app/_actions.ts and is the
 * server action wired to the sidebar's Logout button. It
 * delegates to NextAuth's `signOut({ redirectTo: "/" })` and
 * then re-issues a `redirect("/")` for belt-and-braces cache
 * invalidation.
 *
 * Both `signOut` and `redirect` are mocked — we don't need the
 * real Next.js runtime to verify the action's contract:
 *
 *  1. It calls `signOut({ redirectTo: "/" })`.
 *  2. It then calls `redirect("/")` so cached server
 *     components are re-fetched on the next request.
 */

const signOutMock = vi.fn(async () => undefined);
const redirectMock = vi.fn((url: string) => {
  // Mirror Next's actual behavior: redirect() throws a
  // NEXT_REDIRECT-shaped error so the framework can convert it
  // into a 302.
  const err = new Error(`NEXT_REDIRECT:${url}`);
  (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;${url}`;
  throw err;
});

vi.mock("@/auth", () => ({
  signOut: signOutMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

afterEach(() => {
  signOutMock.mockClear();
  redirectMock.mockClear();
});

describe("signOutAction (US-003)", () => {
  it("calls signOut with redirectTo='/' and then redirects to /", async () => {
    const { signOutAction } = await import("@/app/app/_actions");

    // The action throws because the mocked redirect() throws.
    // We catch the throw and assert the mocks were called in
    // the right order.
    await expect(signOutAction()).rejects.toThrow(/NEXT_REDIRECT/);

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/" });
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("works whether or not a formData argument is passed", async () => {
    const { signOutAction } = await import("@/app/app/_actions");

    // The action is invoked from a <form action={...}>, so
    // React always passes a FormData. But the signature also
    // tolerates being called with no args (for tests or
    // programmatic invocation).
    await expect(
      signOutAction(new FormData()),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(signOutMock).toHaveBeenCalledTimes(1);

    await expect(signOutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(signOutMock).toHaveBeenCalledTimes(2);
  });
});
