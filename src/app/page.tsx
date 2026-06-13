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
      </div>
    </main>
  );
}
