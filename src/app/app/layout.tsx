import { cn } from "@/lib/cn";
import { AppSidebar } from "@/components/app-sidebar";
import { AppBottomNav } from "@/components/app-bottom-nav";

/**
 * /app — client portal (authenticated). Renders a sidebar nav (desktop)
 * and a bottom nav (mobile) around the actual page content.
 *
 * Auth: handled by `requireUser()` at each page; this layout itself
 * doesn't gate — pages call `requireUser()` and throw if no cookie.
 */
export default function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-full flex-1",
        "bg-zinc-50 dark:bg-zinc-950"
      )}
    >
      <AppSidebar />
      <div className="flex flex-1 flex-col min-w-0">
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <AppBottomNav />
      </div>
    </div>
  );
}