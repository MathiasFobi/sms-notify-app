import * as React from "react";
import { Calendar, Inbox, MessageSquare, Wallet } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { getDashboardStats } from "@/lib/dashboard";
import { cn } from "@/lib/cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * /app/dashboard — client portal landing page (US-003).
 *
 * Renders four stat cards with the user's real numbers. The
 * data is fetched on the server in this page (not in the
 * layout) so the topbar's credit balance and the dashboard
 * stat cards can share a single query, but the dashboard
 * always has its own stat calls — the layout is the topbar
 * and shouldn't be coupled to every page's data needs.
 *
 * Each card includes:
 *  - An icon
 *  - A title
 *  - The integer count formatted with toLocaleString
 *  - A one-line description
 *
 * If the user has zero of something the number still renders
 * (we explicitly format "0") so the layout doesn't shift when
 * a real value arrives.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const userId = Number(user.id);

  // Re-derive the session name for the greeting. `user.name`
  // falls back to `user.email` in `requireUser()` callers, but
  // the layout already does the same, so this is just a display
  // concern.
  const displayName = user.name ?? user.email ?? "there";

  const stats = await getDashboardStats(userId);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s a snapshot of your SMS activity.
        </p>
      </header>

      <section
        aria-label="Dashboard stats"
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        <StatCard
          title="Credits balance"
          icon={<Wallet className="h-5 w-5" aria-hidden />}
          value={stats.credits}
          description="Available to send."
        />
        <StatCard
          title="Messages sent (30d)"
          icon={<MessageSquare className="h-5 w-5" aria-hidden />}
          value={stats.messages30d}
          description="Outbound in the last 30 days."
        />
        <StatCard
          title="Scheduled"
          icon={<Calendar className="h-5 w-5" aria-hidden />}
          value={stats.scheduled}
          description="Pending scheduled sends."
        />
        <StatCard
          title="Unread replies"
          icon={<Inbox className="h-5 w-5" aria-hidden />}
          value={stats.unread}
          description="Inbound messages waiting."
        />
      </section>
    </div>
  );
}

function StatCard({
  title,
  icon,
  value,
  description,
}: {
  title: string;
  icon: React.ReactNode;
  value: number;
  description: string;
}) {
  const display = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return (
    <Card data-testid={`stat-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tabular-nums">
          {display.toLocaleString()}
        </div>
        <CardDescription className="mt-1">{description}</CardDescription>
      </CardContent>
    </Card>
  );
}
