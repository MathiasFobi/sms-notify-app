import * as React from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, users } from "@/db/schema";
import { auth } from "@/auth";
import { cn } from "@/lib/cn";
import { Sidebar } from "@/components/ui/sidebar";
import { CreditsBadge } from "@/components/credits-badge";
import { UserMenu } from "@/components/user-menu";
import { ToastProvider } from "@/components/ui/toast";
import { signOutAction } from "@/app/app/_actions";

/**
 * /app — client portal layout.
 *
 * Wraps every authenticated route under `/app/*`. The layout:
 *
 *  - Reads the current session via `auth()`.
 *  - Looks up the matching `accounts` row for the credit
 *    balance. The accounts table is the source of truth for
 *    `credits`; the topbar reads it directly so the badge
 *    doesn't issue a second query.
 *  - Renders a fixed sidebar (with a mobile slide-in drawer)
 *    plus a topbar containing the credits badge and user menu.
 *  - Wraps the page body in a ToastProvider so any client
 *    component on the page can show success/error toasts.
 *
 * If for some reason a request reaches this layout without a
 * session, we render the sidebar/topbar with a zero-credit
 * placeholder rather than throwing — `requireUser()` on the
 * individual page is the actual gate, and the proxy/middleware
 * redirects unauthenticated users before they get here.
 */
export default async function AppPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;

  // Pull the credit balance for the topbar. One query, joined
  // on userId. A missing accounts row is treated as 0 credits
  // (shouldn't happen in practice — every signup creates one
  // — but a defensive fallback keeps the page from crashing).
  let credits = 0;
  if (userId) {
    const [acct] = await db
      .select({ credits: accounts.credits, name: users.name, email: users.email })
      .from(accounts)
      .innerJoin(users, eq(users.id, accounts.userId))
      .where(eq(accounts.userId, userId))
      .limit(1);
    credits = acct?.credits ?? 0;
  }

  const displayName =
    session?.user?.name ?? session?.user?.email ?? "Account";

  return (
    <ToastProvider>
      <div className={cn("flex min-h-full flex-1")}>
        <Sidebar signOutAction={signOutAction} />
        <div className="flex min-h-screen flex-1 flex-col">
          <header
            className={cn(
              "sticky top-0 z-30 flex h-14 items-center gap-3 border-b",
              "border-sidebar-border bg-background/80 px-4 backdrop-blur",
              "md:px-6",
            )}
          >
            <div className="flex-1" />
            <CreditsBadge credits={credits} />
            <UserMenu
              name={displayName}
              email={session?.user?.email ?? null}
              signOutAction={signOutAction}
            />
          </header>
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
