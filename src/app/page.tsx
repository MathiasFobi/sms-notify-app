import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Marketing / landing page for sms-notify-app.
 *
 * This is a Server Component so it runs on the server and returns 200 OK by
 * default (no client-side redirects, no dynamic=force-dynamic needed).
 */
export default function Home() {
  return (
    <main
      className={cn(
        "flex flex-1 w-full items-center justify-center",
        "bg-gradient-to-b from-zinc-50 to-zinc-100",
        "dark:from-zinc-950 dark:to-zinc-900",
        "px-6 py-24",
      )}
    >
      <div className="flex max-w-2xl flex-col items-center text-center">
        <div
          className={cn(
            "mb-6 inline-flex items-center gap-2 rounded-full",
            "border border-zinc-200 bg-white/70 px-3 py-1",
            "text-xs font-medium text-zinc-600",
            "dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>sms-notify-app</span>
        </div>
        <h1
          className={cn(
            "text-balance text-4xl font-semibold tracking-tight",
            "sm:text-5xl",
          )}
        >
          sms-notify-app
        </h1>
        <p
          className={cn(
            "mt-4 max-w-prose text-balance text-lg leading-8",
            "text-zinc-600 dark:text-zinc-400",
          )}
        >
          A production SMS notification web app. Sign in to send, schedule,
          and track bulk SMS — the web-first alternative to spreadsheet
          gateways.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center gap-3">
          <a
            href="/signup"
            className={cn(
              "inline-flex items-center justify-center gap-2",
              "rounded-lg bg-cyan-600 hover:bg-cyan-700",
              "px-6 py-3 text-sm font-semibold text-white",
              "transition shadow-sm",
            )}
          >
            Create your account
          </a>
          <a
            href="/signup"
            className={cn(
              "inline-flex items-center justify-center gap-2",
              "rounded-lg border border-zinc-300 dark:border-zinc-700",
              "bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800",
              "px-6 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50",
              "transition",
            )}
          >
            Sign in
          </a>
        </div>
        <p className="mt-6 text-xs text-zinc-500 dark:text-zinc-500">
          Mock-data build — real auth + Stripe + Twilio land in a later story.
        </p>
      </div>
    </main>
  );
}
