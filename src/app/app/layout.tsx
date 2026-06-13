import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * /app — client portal (authenticated). Placeholder for the next stories.
 * Auth, dashboard, contacts, messages, etc. will be wired up under here.
 */
export default function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-full flex-1 flex-col")}>
      <header
        className={cn(
          "flex h-14 items-center gap-2 border-b border-zinc-200",
          "bg-white px-6 dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <MessageSquare className="h-5 w-5 text-zinc-700 dark:text-zinc-300" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          sms-notify-app
        </span>
        <span
          className={cn(
            "ml-2 rounded-full bg-zinc-100 px-2 py-0.5",
            "text-xs font-medium text-zinc-600",
            "dark:bg-zinc-800 dark:text-zinc-400",
          )}
        >
          Portal
        </span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
