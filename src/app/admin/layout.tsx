import { Shield } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * /admin — operator console (King). Placeholder for the next stories.
 * Tenants, abuse reports, billing overrides, etc. will live under here.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-full flex-1 flex-col",
        "bg-zinc-100 dark:bg-zinc-900",
      )}
    >
      <header
        className={cn(
          "flex h-14 items-center gap-2 border-b border-zinc-300",
          "bg-zinc-900 px-6 dark:border-zinc-800",
        )}
      >
        <Shield className="h-5 w-5 text-amber-400" />
        <span className="text-sm font-semibold text-zinc-50">
          sms-notify-app
        </span>
        <span
          className={cn(
            "ml-2 rounded-full bg-amber-400/10 px-2 py-0.5",
            "text-xs font-medium text-amber-400",
          )}
        >
          Admin
        </span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
