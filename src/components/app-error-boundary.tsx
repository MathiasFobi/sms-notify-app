"use client";

/**
 * Top-level error boundary for the /app/* portal.
 *
 * Catches:
 *   - Server Component render errors (a child's `requireUser` throws,
 *     a DB call fails, etc.)
 *   - Client component runtime errors during render
 *
 * Renders a friendly fallback that still preserves the portal
 * chrome (sidebar + bottom nav) so the user can navigate to a
 * different page rather than seeing a full crash screen.
 *
 * In dev mode, Next's overlay is preferred — it shows stack traces
 * and the digest. We only render this fallback in production.
 */

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/cn";

export interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Console-log so production traces are at least discoverable in
    // the browser console. The server-side log is in Vercel's
    // function logs (search for the digest value).
    console.error("AppErrorBoundary caught:", error, info);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const error = this.state.error;
    const isDev = process.env.NODE_ENV !== "production";

    return (
      <div
        className={cn(
          "mx-auto my-12 max-w-md rounded-xl border border-rose-200",
          "bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/30",
          "p-6 text-center",
        )}
        role="alert"
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Something went wrong rendering this page
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The page hit an unexpected error. The other pages in the portal
          should still work — try navigating via the sidebar.
        </p>
        {isDev && error ? (
          <pre className="mt-3 max-h-40 overflow-auto rounded bg-zinc-900 px-3 py-2 text-left text-[11px] text-rose-300">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="secondary" onClick={this.handleRetry}>
            <RotateCw className="h-3.5 w-3.5 mr-1" />
            Try again
          </Button>
          <a
            href="/app/dashboard"
            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600 hover:bg-cyan-700 text-white transition"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    );
  }
}