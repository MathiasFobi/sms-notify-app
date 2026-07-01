import { cn } from "@/lib/cn";
import { requireAdmin } from "@/lib/auth";
import { adminListUsersAction, adminAdjustCreditsAction } from "@/lib/actions/admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ADMIN_ADJUST_REASONS } from "@/lib/admin/reasons";

/**
 * /admin/users — admin-only user management.
 *
 * Two concerns:
 *
 *  1. **List + search.** Reads every user (paginated in a future
 *     story; capped at 100 today) joined with their `accounts.credits`
 *     balance. Renders as a Table with email / name / credits /
 *     created_at columns. The search input is a plain `<form>` that
 *     re-renders the page with a `?query=<substring>` URL param so
 *     the search is bookmarkable + back-button friendly.
 *
 *  2. **Adjust credits.** Inline per-row form with a number input
 *     (`delta`) and a `<select>` of allowed reasons (`support`,
 *     `refund`, `goodwill`, `correction`, `chargeback`). Submits
 *     via an inline server action declared in this file. The
 *     action delegates to `adminAdjustCreditsAction` from
 *     `src/lib/actions/admin.ts`.
 *
 * Auth:
 *   `requireAdmin()` at the top of the render path 404s for any
 *   non-admin caller (which collapses "you're not allowed" with
 *   "this page doesn't exist" — non-admins can't probe the admin
 *   surface for existence).
 */

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ query?: string }>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  // Auth gate. Throws `notFound()` for non-admin callers.
  await requireAdmin();

  const { query: rawQuery } = await searchParams;
  const query =
    typeof rawQuery === "string" && rawQuery.trim().length > 0
      ? rawQuery.trim()
      : undefined;

  const { users } = await adminListUsersAction({ query, limit: 100 });

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl flex-col gap-6 p-6",
      )}
      data-testid="admin-users-page"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Users
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {users.length} {users.length === 1 ? "user" : "users"}
          {query ? ` matching "${query}"` : ""}
        </p>
      </header>

      <section
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-4 shadow-sm",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
        data-testid="admin-users-search-section"
      >
        <form
          method="GET"
          action="/admin/users"
          className="flex items-end gap-3"
          data-testid="admin-users-search-form"
        >
          <div className="flex flex-1 flex-col gap-1">
            <label
              htmlFor="admin-users-search-input"
              className="text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
            >
              Search
            </label>
            <Input
              id="admin-users-search-input"
              name="query"
              type="text"
              placeholder="Email or name"
              defaultValue={query ?? ""}
              data-testid="admin-users-search-input"
            />
          </div>
          <Button type="submit" variant="primary" data-testid="admin-users-search-button">
            Search
          </Button>
        </form>
      </section>

      {users.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="No users found"
          description={
            query
              ? `No users match "${query}". Try a different search term.`
              : "No users in the system yet."
          }
          data-testid="admin-users-empty-state"
        />
      ) : (
        <section
          className={cn(
            "rounded-lg border border-zinc-200 bg-white shadow-sm",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
          data-testid="admin-users-table-section"
        >
          <Table data-testid="admin-users-table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Adjust</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`admin-user-row-${u.id}`}>
                  <TableCell data-testid={`admin-user-email-${u.id}`}>
                    {u.email}
                  </TableCell>
                  <TableCell data-testid={`admin-user-name-${u.id}`}>
                    {u.name}
                    {u.role === "admin" ? (
                      <span
                        className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                        data-testid={`admin-user-role-badge-${u.id}`}
                      >
                        admin
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`admin-user-credits-${u.id}`}
                    data-value={u.credits}
                  >
                    {u.credits.toLocaleString()}
                  </TableCell>
                  <TableCell
                    className="text-zinc-600 dark:text-zinc-400"
                    data-testid={`admin-user-created-${u.id}`}
                  >
                    {u.createdAt.toISOString().slice(0, 10)}
                  </TableCell>
                  <TableCell>
                    <form
                      method="POST"
                      action={adjustCreditsFormAction.bind(null, u.id)}
                      className="flex items-center justify-end gap-2"
                      data-testid={`admin-adjust-form-${u.id}`}
                    >
                      <Input
                        type="number"
                        name="delta"
                        aria-label={`Delta for ${u.email}`}
                        defaultValue="0"
                        step="1"
                        className="w-20"
                        data-testid={`admin-adjust-delta-${u.id}`}
                      />
                      <select
                        name="reason"
                        aria-label={`Reason for ${u.email}`}
                        defaultValue={ADMIN_ADJUST_REASONS[0]}
                        className={cn(
                          "h-9 rounded-md border border-zinc-200 bg-white px-2 text-sm shadow-sm",
                          "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
                          "dark:border-zinc-700 dark:bg-zinc-900",
                          "dark:focus:ring-zinc-300",
                        )}
                        data-testid={`admin-adjust-reason-${u.id}`}
                      >
                        {ADMIN_ADJUST_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="submit"
                        variant="secondary"
                        data-testid={`admin-adjust-button-${u.id}`}
                      >
                        Apply
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

/**
 * Inline server action bound to the per-row Adjust credits form.
 * Parses `delta` + `reason` from the FormData and delegates to
 * the exported `adminAdjustCreditsAction`.
 *
 * Pattern mirrors the per-row forms on `/app/inbox` (US-015) and
 * `/app/scheduled` (US-011). The page-local action is wrapped
 * with `bind(null, userId)` at the `<form action={...}>` call site
 * so the row's user id is implicit — the form only ships `delta`
 * and `reason` in the body.
 */
async function adjustCreditsFormAction(
  userId: number,
  formData: FormData,
): Promise<void> {
  "use server";
  const deltaRaw = formData.get("delta");
  const reasonRaw = formData.get("reason");

  const delta =
    typeof deltaRaw === "string" ? Number.parseInt(deltaRaw, 10) : NaN;
  const reason = typeof reasonRaw === "string" ? reasonRaw : "";

  if (!Number.isInteger(delta)) return;
  if (delta === 0) return;

  await adminAdjustCreditsAction({ userId, delta, reason });
}