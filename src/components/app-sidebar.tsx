/**
 * Sidebar nav for the /app/* portal. Client component.
 *
 * Lists every page a logged-in user can reach from the app shell, with
 * a "Sign out" link at the bottom. Highlights the active route.
 *
 * The sidebar is desktop-only (md+). On mobile it collapses; the
 * bottom of every page has a compact "back to home" link instead.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Send,
  Inbox,
  Calendar,
  Receipt,
  BarChart3,
  Settings,
  MessageSquare,
  IdCard,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/app/dashboard",   label: "Dashboard",  icon: LayoutDashboard },
  { href: "/app/send",        label: "Send",       icon: Send },
  { href: "/app/scheduled",   label: "Scheduled",  icon: Calendar },
  { href: "/app/inbox",       label: "Inbox",      icon: Inbox },
  { href: "/app/contacts",    label: "Contacts",   icon: Users },
  { href: "/app/sender-ids",  label: "Sender IDs", icon: IdCard },
  { href: "/app/reports",     label: "Reports",    icon: BarChart3 },
  { href: "/app/billing",     label: "Billing",    icon: Receipt },
  { href: "/app/settings",    label: "Settings",   icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="flex items-center gap-2 h-14 px-4 border-b border-zinc-200 dark:border-zinc-800">
        <MessageSquare className="h-5 w-5 text-cyan-600" />
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          sms-notify-app
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition",
                active
                  ? "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  active ? "text-cyan-600 dark:text-cyan-400" : "text-zinc-500"
                )}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 dark:border-zinc-800 p-3 space-y-1">
        <Link
          href="/"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 transition"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </Link>
      </div>
    </aside>
  );
}