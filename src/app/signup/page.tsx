"use client";

/**
 * Minimal signup page — allows a new user to register for the SMS
 * notification app.
 *
 * This is the lightweight seam described in the run task brief:
 * `/signup` is a public route that lets a brand-new visitor create an
 * account, set a session cookie, and be redirected to the user portal.
 *
 * It exists because the full NextAuth credentials flow is deferred to
 * a later story; the in-app auth story (US-014 in the original 20)
 * was intentionally dropped from the 17-story mock-build run. This
 * page fills that gap with the minimum surface area required to log
 * in end-to-end so the deployed app can be poked at on Vercel.
 *
 * Behavior:
 *   - Validates name + email + password locally (zod).
 *   - POSTs to `/api/signup` (a tiny route handler in this same dir).
 *   - On success: server sets the `__user-cookie` and redirects to
 *     `/app/dashboard`.
 *   - On failure: surfaces the error message inline.
 *
 * No styling beyond what the existing shadcn-ish primitives provide;
 * the visual match to the rest of the app is best-effort. This page
 * is meant to be replaced by the proper NextAuth signup UI later.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";

const SignupSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  email: z.string().email("Invalid email address").max(160),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = SignupSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }

    startTransition(async () => {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.redirected) {
        router.push(res.url);
        router.refresh();
        return;
      }
      if (res.ok) {
        router.push("/app/dashboard");
        router.refresh();
        return;
      }
      const text = await res.text();
      try {
        const json = JSON.parse(text) as { error?: string };
        setError(json.error ?? `Signup failed: ${res.status}`);
      } catch {
        setError(`Signup failed: ${res.status}`);
      }
    });
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display font-extrabold text-3xl tracking-tight text-zinc-900 dark:text-zinc-50">
            Create your account
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            Mock-data build · Production SMS notification platform
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4"
        >
          <div>
            <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500"
              placeholder="Your name"
              disabled={isPending}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500"
              placeholder="you@example.com"
              disabled={isPending}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500"
              placeholder="Min 8 characters"
              disabled={isPending}
            />
          </div>

          {error && (
            <div className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white font-semibold text-sm transition"
          >
            {isPending ? "Creating account…" : "Create account"}
          </button>

          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center pt-2">
            Mock-data build — real auth + Stripe + Twilio land in a later story.
          </p>
        </form>
      </div>
    </main>
  );
}