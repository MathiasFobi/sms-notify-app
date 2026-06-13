"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Calendar,
  CreditCard,
  Home,
  Inbox,
  LogOut,
  Menu,
  MessageSquare,
  Send,
  Settings,
  UserCircle2,
  Users,
  X,
} from "lucide-react";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Sidebar nav.
 *
 * The shape of a sidebar item is intentionally tiny: label,
 * href, icon, optional `external` flag. The active state is
 * derived from the current pathname — exactly the path or a
 * sub-route of the item's href is considered "active".
 *
 * The component is a client component because it needs
 * `usePathname()` to compute the active link. The list of nav
 * items is exported separately (`navItems`) so unit tests can
 * assert the link set without rendering the component.
 *
 * Layout:
 *  - Desktop (>= 768px): sticky sidebar always visible.
 *  - Mobile (< 768px): sidebar is hidden by default and slides
 *    in from the left as an overlay when the menu button in the
 *    topbar is pressed. We close the drawer automatically on
 *    navigation.
 */
export type SidebarNavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Renders as a form button (e.g. for Logout) instead of a link. */
  action?: "logout";
};

export const navItems: readonly SidebarNavItem[] = [
  { label: "Dashboard", href: "/app/dashboard", icon: Home },
  { label: "Send SMS", href: "/app/send", icon: Send },
  { label: "Scheduled", href: "/app/scheduled", icon: Calendar },
  { label: "Contacts", href: "/app/contacts", icon: Users },
  { label: "Sender IDs", href: "/app/sender-ids", icon: UserCircle2 },
  { label: "Inbox", href: "/app/inbox", icon: Inbox },
  { label: "Reports", href: "/app/reports", icon: BarChart3 },
  { label: "Billing", href: "/app/billing", icon: CreditCard },
  { label: "Settings", href: "/app/settings", icon: Settings },
  { label: "Logout", href: "/", icon: LogOut, action: "logout" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export type SidebarProps = {
  /**
   * Sign-out server action. Required so the Logout entry can submit.
   * Accepts both a parameterless action (used by some clients) and a
   * `(formData) => …` action (NextAuth's `signOut` signature in
   * the portal's `_actions.ts`).
   */
  signOutAction: (formData?: FormData) => void | Promise<void>;
};

export function Sidebar({ signOutAction }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the drawer whenever the route changes so navigating
  // from the menu dismisses the overlay. We watch pathname
  // instead of the click event so back/forward also dismisses.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Mobile menu trigger — only visible below md. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open menu"
        className="md:hidden"
        onClick={() => setOpen(true)}
        data-testid="sidebar-menu-toggle"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Mobile backdrop. Clicking it dismisses the drawer. */}
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/40 md:hidden",
          )}
          aria-hidden
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        data-testid="sidebar"
        data-state={open ? "open" : "closed"}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r",
          "border-sidebar-border bg-sidebar-background text-sidebar-foreground",
          "transition-transform duration-200",
          // Mobile: translate off-screen unless `open`. Desktop: static.
          open ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <Link
            href="/app/dashboard"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <MessageSquare className="h-5 w-5" />
            <span>sms-notify-app</span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            className="md:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2" aria-label="Portal navigation">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);
              const className = cn(
                "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm",
                "transition-colors",
                active
                  ? "bg-sidebar-active text-sidebar-active-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              );

              if (item.action === "logout") {
                return (
                  <li key={item.label}>
                    <form action={signOutAction} className="w-full">
                      <button
                        type="submit"
                        className={className}
                        data-testid={`sidebar-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </button>
                    </form>
                  </li>
                );
              }

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className={className}
                    data-testid={`sidebar-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
