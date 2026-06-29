import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/auth/require-user";
import { getTestDb } from "@/test/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { getDeliveryReport } from "@/lib/reports";
import { getCostSummary } from "@/lib/reports-cost";

/**
 * /app/reports — per-message delivery + credit-spend audit page.
 *
 * Server Component:
 *
 *   1. Resolve the current user via `requireUser()`.
 *   2. Read both summaries (`getDeliveryReport` + `getCostSummary`)
 *      scoped to the user, with the default 30-day window.
 *   3. Render two summary cards (delivery counts + cost totals) and
 *      a Table of every message in range (newest-first). Each row
 *      shows body / status / recipient counts / sent & delivered
 *      timestamps.
 *   4. When the user has no messages in range, render the
 *      `EmptyState` primitive in place of the table.
 *
 * Why two cards + a table (not a single tile or a chart):
 *   - The audit page is the one place a user goes to answer
 *     "what did I actually send, what did it cost, did it land?"
 *     Each card answers one question; the table ties the two
 *     together per send.
 *   - We don't have a chart library installed and adding one for
 *     one page would be over-scope. Numbers + a table tell the
 *     whole story for the volumes the app is sized for.
 *
 * Note on "in-range" filtering: both helpers default to a 30-day
 * window. A future story could add a `<select>` or date inputs to
 * override the range; for US-017 we render the default window and
 * let the page text mention it explicitly.
 */

export const dynamic = "force-dynamic";

function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function formatStatusBadge(status: string): string {
  switch (status) {
    case "delivered":
      return "Delivered";
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    case "sending":
      return "Sending";
    case "queued":
      return "Queued";
    case "received":
      return "Received";
    default:
      return status;
  }
}

export default async function ReportsPage() {
  const user = await requireUser();
  const db = getTestDb();

  const [delivery, cost] = await Promise.all([
    getDeliveryReport(user.id, {}, db),
    getCostSummary(user.id, {}, db),
  ]);

  return (
    <div className={cn("mx-auto w-full max-w-5xl px-6 py-10")}>
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Reports
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Per-message delivery stats and credit spend for the last 30 days.
        </p>
      </header>

      {/* ----- Summary cards ------------------------------------------ */}
      <section
        className={cn(
          "mb-10 grid gap-4 sm:grid-cols-2",
        )}
        data-testid="reports-summary"
      >
        {/* Delivery card. */}
        <article
          data-testid="reports-delivery-card"
          className={cn(
            "rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Delivery (last 30 days)
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Sent
              </dt>
              <dd
                data-testid="reports-total-sent"
                data-value={delivery.totalSent}
                className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                {delivery.totalSent.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Delivered
              </dt>
              <dd
                data-testid="reports-total-delivered"
                data-value={delivery.totalDelivered}
                className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400"
              >
                {delivery.totalDelivered.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Failed
              </dt>
              <dd
                data-testid="reports-total-failed"
                data-value={delivery.totalFailed}
                className="mt-1 text-2xl font-semibold tracking-tight text-rose-700 dark:text-rose-400"
              >
                {delivery.totalFailed.toLocaleString()}
              </dd>
            </div>
          </dl>
        </article>

        {/* Cost card. */}
        <article
          data-testid="reports-cost-card"
          className={cn(
            "rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Credit spend (last 30 days)
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Spent
              </dt>
              <dd
                data-testid="reports-total-spent"
                data-value={cost.totalSpent}
                className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
              >
                {cost.totalSpent.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Purchased
              </dt>
              <dd
                data-testid="reports-total-purchased"
                data-value={cost.totalPurchased}
                className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-400"
              >
                {cost.totalPurchased.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
                Refunded
              </dt>
              <dd
                data-testid="reports-total-refunds"
                data-value={cost.totalRefunds}
                className="mt-1 text-2xl font-semibold tracking-tight text-zinc-700 dark:text-zinc-300"
              >
                {cost.totalRefunds.toLocaleString()}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      {/* ----- Per-message table -------------------------------------- */}
      <section className={cn("mt-2")} data-testid="reports-messages">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Messages
        </h2>
        {delivery.perMessage.length === 0 ? (
          <EmptyState
            title="No messages in the last 30 days"
            description="Send a campaign or single message from the Send page and it will appear here."
          />
        ) : (
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-zinc-200 bg-white",
              "dark:border-zinc-800 dark:bg-zinc-950",
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Body</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Sent at</TableHead>
                  <TableHead>Delivered at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delivery.perMessage.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid={`reports-row-${row.id}`}
                  >
                    <TableCell>
                      <span className="line-clamp-2 max-w-md text-sm text-zinc-700 dark:text-zinc-300">
                        {row.body}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        data-testid={`reports-status-${row.id}`}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5",
                          "text-xs font-medium",
                          row.status === "delivered"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : row.status === "failed"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
                              : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
                        )}
                      >
                        {formatStatusBadge(row.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                        {row.recipientCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        data-testid={`reports-delivered-${row.id}`}
                        className="font-mono text-sm text-emerald-700 dark:text-emerald-400"
                      >
                        {row.deliveredCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        data-testid={`reports-failed-${row.id}`}
                        className="font-mono text-sm text-rose-700 dark:text-rose-400"
                      >
                        {row.failedCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formatDateTime(row.sentAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formatDateTime(row.deliveredAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}