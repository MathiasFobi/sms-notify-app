"use client";

/**
 * Page header that derives breadcrumbs from the current pathname.
 *
 * Renders a small breadcrumb chain (Portal › Section › Subsection) on
 * every /app/* page. The exact mapping lives in `SECTION_TITLES`
 * below; the last segment is omitted (that's the current page's own
 * title, which each page provides itself in its <h1>).
 *
 * We deliberately do NOT replace the per-page <h1>. Pages own their
 * title copy; this component is just the breadcrumb + a thin
 * separator. Pulls the user-name from the cookie-derived payload
 * (same source as `requireUser()`).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/cn";

/** Map a path segment to a human-readable title. */
const SECTION_TITLES: Record<string, string> = {
  app: "Portal",
  dashboard: "Dashboard",
  send: "Send",
  scheduled: "Scheduled",
  inbox: "Inbox",
  contacts: "Contacts",
  "sender-ids": "Sender IDs",
  reports: "Reports",
  billing: "Billing",
  settings: "Settings",
  admin: "Admin",
  users: "Users",
  account: "Account",
  new: "New",
  edit: "Edit",
};

function titleFor(seg: string): string {
  if (SECTION_TITLES[seg]) return SECTION_TITLES[seg];
  // Fallback: humanize "my-page" → "My page"
  return seg
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PageHeader() {
  const pathname = usePathname() ?? "/app";
  const segments = pathname.split("/").filter(Boolean);

  // Skip the "app" prefix (we always show "Portal" as the root)
  const crumbs = segments
    .map((seg, i) => ({
      label: titleFor(seg),
      href: "/" + segments.slice(0, i + 1).join("/"),
    }))
    // Drop the last crumb — that's the current page; pages render their own <h1>
    .slice(0, -1);

  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 sm:mb-6 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <ol className="flex items-center gap-1.5 flex-wrap">
        <li className="flex items-center gap-1.5">
          <Link
            href="/app/dashboard"
            className="inline-flex items-center gap-1 hover:text-zinc-700 dark:hover:text-zinc-200 transition"
          >
            <Home className="h-3 w-3" />
            <span>Portal</span>
          </Link>
        </li>
        {crumbs.map((c, i) => {
          if (i === 0 && c.label === "Portal") return null;
          const isLast = i === crumbs.length - 1;
          return (
            <li key={c.href} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-zinc-300 dark:text-zinc-600" />
              {isLast ? (
                <span
                  className={cn(
                    "font-medium text-zinc-700 dark:text-zinc-200"
                  )}
                  aria-current="page"
                >
                  {c.label}
                </span>
              ) : (
                <Link
                  href={c.href}
                  className="hover:text-zinc-700 dark:hover:text-zinc-200 transition"
                >
                  {c.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}