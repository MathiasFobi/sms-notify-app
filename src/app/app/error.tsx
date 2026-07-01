"use client";

/**
 * Per-page error boundary for the /app/* routes.
 *
 * In Next.js, an `error.tsx` file colocated with a page catches
 * unhandled errors thrown during that page's render (or in nested
 * client components). It runs INSIDE the parent layout, so the
 * sidebar + bottom nav + breadcrumbs keep rendering — the user
 * still has a way to navigate.
 *
 * Mirrors the design of `app-error-boundary` but rendered in-place
 * (no padding) so it slots into the existing main content.
 */

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Mirror to the console so production errors surface in the
    // browser devtools (and the digest + stack are at least findable
    // in Vercel logs for the matching function).
    console.error("AppError caught:", error);
  }, [error]);

  return (
    <div
      className={cn(
        "mx-auto my-8 max-w-md rounded-xl border border-rose-200",
        "bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/30",
        "p-6 text-center",
      )}
      role="alert"
    >
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        Something went wrong on this page
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        The page hit an unexpected error. Other pages in the portal
        should still work — try the sidebar to navigate elsewhere.
      </p>
      {error.digest ? (
        <p className="mt-2 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 break-all">
          digest: {error.digest}
        </p>
      ) : null}
      <div className="mt-4">
        <Button variant="secondary" onClick={() => reset()}>
          <RotateCw className="h-3.5 w-3.5 mr-1" />
          Try again
        </Button>
      </div>
    </div>
  );
}