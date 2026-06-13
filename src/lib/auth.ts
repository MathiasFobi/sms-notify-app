import { redirect } from "next/navigation";
import { auth, signIn, signOut, handlers } from "@/auth";

/**
 * Public auth API for the app.
 *
 * - `auth()` is the read-only helper to fetch the current session
 *   in a server component or server action. Returns `null` if
 *   the user is not signed in.
 * - `signIn()` is the programmatic entry to NextAuth's sign-in
 *   flow. Used by the login form's server action and the
 *   signup flow's auto-sign-in.
 * - `signOut()` ends the session and clears the cookie.
 * - `requireUser()` is a thin wrapper that throws a redirect to
 *   `/login` if there's no session. Use it on every page that
 *   must be authenticated.
 * - `handlers` is the catch-all NextAuth route handler — see
 *   `src/app/api/auth/[...nextauth]/route.ts`.
 *
 * We re-export from `@/auth` so consumers don't have to know
 * the internal file layout; if we ever want to swap the auth
 * library only the imports in this file change.
 */

export { auth, signIn, signOut, handlers };

/**
 * Server-side guard for protected pages.
 *
 * Throws a `NEXT_REDIRECT` to `/login` (which Next.js catches and
 * converts into a real HTTP 302) when there's no session. The
 * `callbackUrl` round-trips the user back to where they were
 * trying to go.
 *
 * Callers must `await` it. The function is async because `auth()`
 * is.
 *
 * Usage:
 *   export default async function DashboardPage() {
 *     const user = await requireUser();
 *     return <h1>Welcome, {user.name}</h1>;
 *   }
 */
export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login?callbackUrl=%2Fapp%2Fdashboard");
  }
  return session.user;
}
