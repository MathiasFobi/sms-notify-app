import { requireUser } from "@/lib/auth";
import { signOutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/cn";

/**
 * /app/dashboard — protected client portal landing page.
 *
 * Calls `requireUser()` to enforce the auth gate. If the user
 * isn't signed in, that helper throws a `redirect()` to `/login`.
 *
 * The page is intentionally minimal — it's the smallest possible
 * surface that proves US-002's auth flow end-to-end. The story's
 * acceptance criteria only need the redirect behavior + a 200
 * after sign-in; downstream stories (US-003+) will flesh this
 * page out into a real dashboard.
 */
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className={cn("flex flex-1 items-center justify-center p-12")}>
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {user.name ?? user.email}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          You&apos;re signed in as {user.email}.
        </p>
        <form action={signOutAction} className="mt-6">
          <button
            type="submit"
            className={cn(
              "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium",
              "hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800",
            )}
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
