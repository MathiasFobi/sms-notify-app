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
import {
  PACKAGES,
  formatPriceUsd,
  type CreditPackage,
} from "@/lib/billing/packages";
import { PurchaseButton } from "./_components/purchase-button";

/**
 * /app/billing — buy credits via the mock provider and review the
 * purchase history.
 *
 * Server Component:
 *
 *   1. Resolve the current user via `requireUser()`.
 *   2. Read `accounts.credits` for the current balance.
 *   3. Render one card per entry in `PACKAGES` (Starter / Growth /
 *      Scale) with a `<PurchaseButton>` that delegates to
 *      `startCheckoutAction` and then navigates to the returned URL.
 *   4. Render a Table of past `credit_transactions` rows where
 *      `reason IN ('purchase', 'refund', 'admin_adjust')`,
 *      newest-first by `created_at`. Empty-state copy when the
 *      user has no qualifying transactions yet.
 *
 * Why a server component: rendering the balance + history is
 * straight SELECTs off the active DB. The `PurchaseButton` is a
 * small `"use client"` island; the rest can stay server-rendered.
 *
 * Why hard-code `PACKAGES` instead of fetching from Stripe: the
 * mock billing layer reads its prices from this module directly
 * (see `src/lib/actions/billing.ts`). Keeping the catalog in one
 * place keeps checkout, display, and tests in lock-step. When the
 * real Stripe provider ships, this page will read prices from the
 * Stripe Product catalog instead.
 */

export const dynamic = "force-dynamic";

const HISTORY_REASONS = ["purchase", "refund", "admin_adjust"] as const;
type HistoryReason = (typeof HISTORY_REASONS)[number];

function isHistoryReason(value: string): value is HistoryReason {
  return (HISTORY_REASONS as readonly string[]).includes(value);
}

interface CreditTransactionRow {
  id: number;
  delta: number;
  reason: string;
  createdAt: Date;
}

/**
 * Read every `credit_transactions` row for `userId` and filter to
 * the reasons the billing page surfaces (purchase, refund,
 * admin_adjust). Sorted newest-first by `created_at`. The shim has
 * no `IN` support, so we read all user rows and filter in JS.
 */
async function loadHistory(
  userId: number,
  db: ReturnType<typeof getTestDb>,
): Promise<CreditTransactionRow[]> {
  const allRows = await db.select("credit_transactions", { user_id: userId });
  return allRows
    .filter((r) => isHistoryReason(String(r.reason ?? "")))
    .map<CreditTransactionRow>((r) => ({
      id: r.id as number,
      delta: typeof r.delta === "number" ? (r.delta as number) : 0,
      reason: String(r.reason ?? ""),
      createdAt: (r.created_at as Date | null) ?? new Date(0),
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function formatTxnReason(reason: string): string {
  switch (reason) {
    case "purchase":
      return "Purchase";
    case "refund":
      return "Refund";
    case "admin_adjust":
      return "Admin adjustment";
    default:
      // Out-of-band reason fell through; still render something.
      return reason;
  }
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export default async function BillingPage() {
  const user = await requireUser();
  const db = getTestDb();

  // ---- Balance ---------------------------------------------------------

  const accountRows = await db.select("accounts", { user_id: user.id });
  const balance =
    accountRows.length > 0 &&
    typeof accountRows[0]!.credits === "number"
      ? (accountRows[0]!.credits as number)
      : 0;

  // ---- History ---------------------------------------------------------

  const history = await loadHistory(user.id, db);

  // ---- Render ----------------------------------------------------------

  return (
    <div className={cn("mx-auto w-full max-w-4xl px-6 py-10")}>
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Billing
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Top up your credit balance or review your purchase history.
        </p>
      </header>

      {/* ----- Balance card ------------------------------------------- */}
      <section
        data-testid="billing-balance"
        className={cn(
          "mb-10 rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Current balance
          </h2>
          <span
            data-testid="billing-balance-value"
            className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100"
          >
            {balance.toLocaleString()}{" "}
            <span className="text-base font-medium text-zinc-500 dark:text-zinc-400">
              credits
            </span>
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
          Each outbound SMS costs 1 credit.
        </p>
      </section>

      {/* ----- Package cards ------------------------------------------ */}
      <section className={cn("mb-10")} data-testid="billing-packages">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Credit packages
        </h2>
        <div
          className={cn(
            "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {PACKAGES.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      </section>

      {/* ----- History table ------------------------------------------ */}
      <section className={cn("mt-10")} data-testid="billing-history">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Purchase history
        </h2>
        {history.length === 0 ? (
          <EmptyState
            title="No purchases yet"
            description="Buy a credit package above and your transaction history will appear here."
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
                  <TableHead>Date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow
                    key={row.id}
                    data-testid={`billing-history-row-${row.id}`}
                  >
                    <TableCell>
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formatDateTime(row.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {formatTxnReason(row.reason)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        data-testid={`billing-history-delta-${row.id}`}
                        data-delta={row.delta}
                        className={cn(
                          "font-mono text-sm",
                          row.delta >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-zinc-700 dark:text-zinc-300",
                        )}
                      >
                        {row.delta > 0 ? "+" : ""}
                        {row.delta}
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

// ============================================================================
// Package card (server-rendered; the action button is a client island)
// ============================================================================

function PackageCard({ pkg }: { pkg: CreditPackage }) {
  return (
    <article
      data-testid={`billing-package-${pkg.id}`}
      data-package-credits={pkg.credits}
      data-price-usd-cents={pkg.priceUsdCents}
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-5",
        "dark:border-zinc-800 dark:bg-zinc-950",
      )}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {pkg.name}
        </h3>
        <span
          data-testid={`billing-package-price-${pkg.id}`}
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {formatPriceUsd(pkg.priceUsdCents)}
        </span>
      </header>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {pkg.description}
      </p>
      <div className="flex items-baseline justify-between">
        <span
          data-testid={`billing-package-credits-${pkg.id}`}
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {pkg.credits.toLocaleString()} credits
        </span>
        <PurchaseButton
          packageCredits={pkg.credits}
          label={`Buy for ${formatPriceUsd(pkg.priceUsdCents)}`}
        />
      </div>
    </article>
  );
}
