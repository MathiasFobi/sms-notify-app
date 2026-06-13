"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signInAction, type ActionResult } from "@/lib/actions/auth";
import { cn } from "@/lib/cn";

/**
 * /login — credentials login form.
 *
 * The form is a client component because it uses `useActionState`
 * to read the server action's return value and re-render with the
 * error inline. The action itself runs on the server.
 *
 * The page is intentionally simple — US-002 doesn't call for a
 * polished design. Polish comes in later stories.
 */
export default function LoginPage() {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ redirectTo: string }> | undefined,
    FormData
  >(signInAction, undefined);

  return (
    <div
      className={cn(
        "flex min-h-screen flex-1 items-center justify-center",
        "bg-zinc-50 px-6 py-12 dark:bg-zinc-950",
      )}
    >
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Log in to sms-notify-app
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Welcome back. Enter your email and password.
        </p>

        <form action={formAction} className="mt-8 space-y-4" noValidate>
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={cn(
                "mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2",
                "text-sm shadow-sm focus:border-zinc-500 focus:outline-none",
                "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
              )}
            />
            {state && !state.ok && state.fieldErrors?.["email"] && (
              <p className="mt-1 text-xs text-red-600">
                {state.fieldErrors["email"]}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={cn(
                "mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2",
                "text-sm shadow-sm focus:border-zinc-500 focus:outline-none",
                "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
              )}
            />
            {state && !state.ok && state.fieldErrors?.["password"] && (
              <p className="mt-1 text-xs text-red-600">
                {state.fieldErrors["password"]}
              </p>
            )}
          </div>

          {state && !state.ok && state.error && (
            <p
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={cn(
              "w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white",
              "hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60",
              "dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
            )}
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
