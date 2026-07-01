import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/auth/require-user";
import { getDashboardStats, getMessageVolume30d, getRecentActivity } from "@/lib/dashboard";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActivityItem, MessageVolumeDay } from "@/lib/dashboard";
import { Coins, Send, Plus } from "lucide-react";
import Link from "next/link";

/**
 * /app/dashboard — landing page for the user portal.
 *
 * Server Component:
 *
 *   1. Resolve the current user via `requireUser()`.
 *   2. Read three pieces of scoped data:
 *      a. `getDashboardStats(user.id)` — headline counts (currently
 *         just unread inbound). Drives the stat cards at the top.
 *      b. `getMessageVolume30d(user.id)` — 30-day outbound-message
 *         series. Drives the hand-rolled SVG mini bar chart under
 *         the stat cards.
 *      c. `getRecentActivity(user.id)` — merged feed of the user's
 *         latest outbound + inbound rows. Drives the recent-activity
 *         list at the bottom.
 *   3. Render stat cards → chart → recent activity list. Each
 *      section is its own `<section data-testid="…">` so the page
 *      test can assert on the three pieces independently.
 *
 * Why a hand-rolled SVG chart (no chart library):
 *   - The dashboard's volume chart is a 30-bar histogram. The shape
 *     is <rect> per bar plus an axis line. A library like recharts
 *     or visx would add tens of KB to the client bundle for a single
 *     decorative tile that's not interactive (no tooltips, no
 *     zoom). The hand-rolled version is ~25 lines and ships zero JS.
 *   - The series is already pre-shaped (`date`, `count`); the page
 *     only needs to map it to SVG coordinates.
 *
 * Why no interactivity:
 *   - This is the dashboard landing view. Clicking a bar would take
 *     the user to the Reports page (US-017 already gives them that
 *     view). A future story could add a `<Link>` wrapper around
 *     each bar if we want drill-through.
 */

export const dynamic = "force-dynamic";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatShortDate(date: string): string {
  // `date` is YYYY-MM-DD (UTC). Pull month + day; skip the year
  // because the chart only ever spans 30 days so the year is
  // visually redundant and crowds the x-axis.
  const [, m, d] = date.split("-");
  return `${m}-${d}`;
}

export default async function DashboardPage() {
  const user = await requireUser();

  const [stats, volume, activity] = await Promise.all([
    getDashboardStats(user.id),
    getMessageVolume30d(user.id),
    getRecentActivity(user.id),
  ]);

  const firstName =
    typeof user.row.name === "string" && user.row.name.trim().length > 0
      ? user.row.name.split(" ")[0]!
      : null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          {firstName ? `Welcome back, ${firstName}` : "Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          A quick look at your messaging activity over the last 30 days.
        </p>
      </header>

      {/* ----- Credit balance hero card + Quick send pill ---------- */}
      <section
        className={cn(
          "rounded-xl border border-zinc-200 dark:border-zinc-800",
          "bg-gradient-to-br from-white via-white to-cyan-50/40",
          "dark:from-zinc-950 dark:via-zinc-950 dark:to-cyan-950/20",
          "p-5 sm:p-6",
        )}
        data-testid="dashboard-hero"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                "shrink-0 h-10 w-10 rounded-full flex items-center justify-center",
                stats.credits > 0
                  ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
                  : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
              )}
            >
              <Coins className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Credit balance
              </p>
              <p
                data-testid="dashboard-credits-value"
                data-value={stats.credits}
                className="mt-0.5 text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50"
              >
                {stats.credits.toLocaleString()}
                <span className="ml-1 text-base font-normal text-zinc-500 dark:text-zinc-400">
                  credits
                </span>
              </p>
              {stats.credits === 0 ? (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  You're out of credits. Top up to keep sending.
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                  Each outbound SMS costs 1 credit.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
            <Link
              href="/app/send"
              data-testid="dashboard-quick-send"
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-700 text-white transition"
            >
              <Send className="h-3.5 w-3.5" />
              Quick send
            </Link>
            <Link
              href="/app/billing"
              data-testid="dashboard-buy-credits"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
            >
              <Plus className="h-3 w-3" />
              {stats.credits === 0 ? "Buy credits" : "Top up"}
            </Link>
          </div>
        </div>
      </section>

      {/* ----- Stat cards --------------------------------------------- */}
      <section
        className={cn("grid gap-4 sm:grid-cols-2")}
        data-testid="dashboard-stats"
      >
        <article
          data-testid="dashboard-stat-unread"
          className={cn(
            "rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Unread inbound
          </h2>
          <dd
            data-testid="dashboard-unread-value"
            data-value={stats.unread}
            className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {stats.unread.toLocaleString()}
          </dd>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Inbound messages waiting for you in the inbox.
          </p>
        </article>
        <article
          data-testid="dashboard-stat-volume"
          className={cn(
            "rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Outbound (last 30 days)
          </h2>
          <dd
            data-testid="dashboard-volume-total"
            data-value={volume.reduce((sum, d) => sum + d.count, 0)}
            className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {volume.reduce((sum, d) => sum + d.count, 0).toLocaleString()}
          </dd>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Total outbound messages across the chart window.
          </p>
        </article>
      </section>

      {/* ----- 30-day mini bar chart ---------------------------------- */}
      <section
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
        data-testid="dashboard-chart-section"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Message volume — last 30 days
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Daily outbound-message counts. Each bar = one UTC day.
        </p>
        <div className="mt-4">
          <VolumeChart series={volume} />
        </div>
      </section>

      {/* ----- Recent activity ---------------------------------------- */}
      <section
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
        data-testid="dashboard-activity-section"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Recent activity
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          The latest messages you have sent and received, newest first.
        </p>
        <div className="mt-4">
          <ActivityList activity={activity} />
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// Mini bar chart (hand-rolled SVG)
// ============================================================================

/**
 * SVG constants. ViewBox-based so the chart scales cleanly on any
 * container width without re-computing pixel sizes. Twenty-pixel
 * tall bars fit four rows of dashed-border cards inside the chart
 * wrapper without crowding the axis labels.
 */
const CHART_WIDTH = 600;
const CHART_HEIGHT = 120;
const CHART_PAD_LEFT = 8;
const CHART_PAD_RIGHT = 8;
const CHART_PAD_TOP = 8;
const CHART_PAD_BOTTOM = 24; // room for x-axis ticks

function VolumeChart({ series }: { series: MessageVolumeDay[] }) {
  if (series.length === 0) {
    return (
      <EmptyState
        emoji="📊"
        title="No activity in the last 30 days"
        description="Send a message from the Send page and it will show up here."
        cta={{ label: "Send a message", href: "/app/send" }}
      />
    );
  }

  const maxCount = Math.max(1, ...series.map((d) => d.count));
  const innerWidth = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const barGap = 1;
  const barWidth = Math.max(
    1,
    (innerWidth - barGap * (series.length - 1)) / series.length,
  );

  return (
    <svg
      role="img"
      aria-label="30-day outbound message volume"
      data-testid="dashboard-volume-chart"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className={cn("h-32 w-full text-emerald-600 dark:text-emerald-400")}
    >
      {/* X-axis baseline. */}
      <line
        x1={CHART_PAD_LEFT}
        x2={CHART_WIDTH - CHART_PAD_RIGHT}
        y1={CHART_HEIGHT - CHART_PAD_BOTTOM}
        y2={CHART_HEIGHT - CHART_PAD_BOTTOM}
        className="stroke-zinc-200 dark:stroke-zinc-800"
        strokeWidth={1}
      />
      {series.map((day, i) => {
        const x = CHART_PAD_LEFT + i * (barWidth + barGap);
        // Bars with count=0 collapse to a hairline so the eye reads
        // them as "no activity" rather than "missing bar".
        const h =
          day.count === 0
            ? 1
            : Math.max(1, (day.count / maxCount) * innerHeight);
        const y = CHART_HEIGHT - CHART_PAD_BOTTOM - h;
        return (
          <rect
            key={day.date}
            data-testid={`dashboard-volume-bar-${day.date}`}
            data-date={day.date}
            data-count={day.count}
            x={x}
            y={y}
            width={barWidth}
            height={h}
            rx={1}
            fill="currentColor"
            opacity={day.count === 0 ? 0.18 : 1}
          >
            <title>{`${day.date}: ${day.count} message${day.count === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
      {/* Sparse x-axis ticks — every 5th day keeps the axis legible
          without cramming 30 labels into 600 units. */}
      {series.map((day, i) => {
        if (i % 5 !== 0 && i !== series.length - 1) return null;
        const x = CHART_PAD_LEFT + i * (barWidth + barGap) + barWidth / 2;
        const y = CHART_HEIGHT - CHART_PAD_BOTTOM + 12;
        return (
          <text
            key={`tick-${day.date}`}
            data-testid={`dashboard-volume-tick-${day.date}`}
            x={x}
            y={y}
            textAnchor="middle"
            className="fill-zinc-500 text-[10px] dark:fill-zinc-400"
          >
            {formatShortDate(day.date)}
          </text>
        );
      })}
    </svg>
  );
}

// ============================================================================
// Recent-activity list
// ============================================================================

function ActivityList({ activity }: { activity: ActivityItem[] }) {
  if (activity.length === 0) {
    return (
      <EmptyState
        emoji="📭"
        title="No recent activity"
        description="New outbound sends and inbound replies will show up here."
        cta={{ label: "Send a message", href: "/app/send" }}
      />
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-zinc-200 bg-white",
        "dark:border-zinc-800 dark:bg-zinc-950",
      )}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Direction</TableHead>
            <TableHead>From</TableHead>
            <TableHead>Body</TableHead>
            <TableHead>When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activity.map((item) => (
            <TableRow
              key={`${item.source}-${item.id}`}
              data-testid={`dashboard-activity-row-${item.source}-${item.id}`}
            >
              <TableCell>
                <span
                  data-testid={`dashboard-activity-source-${item.source}-${item.id}`}
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5",
                    "text-xs font-medium",
                    item.source === "outbound"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                      : "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
                  )}
                >
                  {item.source === "outbound" ? "Outbound" : "Inbound"}
                </span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                  {item.from || "—"}
                </span>
              </TableCell>
              <TableCell>
                <span className="line-clamp-2 max-w-md text-sm text-zinc-700 dark:text-zinc-300">
                  {item.body}
                </span>
              </TableCell>
              <TableCell>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">
                  {formatDateTime(item.createdAt)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
