/**
 * Bottom-of-page mobile nav for the /app/* portal. Hidden on desktop.
 *
 * Mirrors the AppSidebar routes in priority order — most-used first.
 * On a phone, this is the only nav; on desktop, the AppSidebar shows.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Send,
  Inbox,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/cn";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/app/dashboard", label: "Home",    icon: LayoutDashboard },
  { href: "/app/send",      label: "Send",    icon: Send },
  { href: "/app/inbox",     label: "Inbox",   icon: Inbox },
  { href: "/app/contacts",  label: "People",  icon: Users },
  { href: "/app/settings",  label: "Me",      icon: Settings },
];

export function AppBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-950/95 backdrop-blur">
      <ul className="flex items-stretch justify-around">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition",
                  active
                    ? "text-cyan-600 dark:text-cyan-400"
                    : "text-zinc-500 dark:text-zinc-400"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}