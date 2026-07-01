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
import { Button } from "@/components/ui/button";
import { markAllReadAction, markReadAction } from "@/lib/actions/inbox";
import { MarkReadButton } from "./_components/mark-read-button";

/**
 * /app/inbox — list the current user's inbound messages and let
 * them mark individual rows (or the whole batch) as read.
 *
 * Server Component:
 *   1. `requireUser()` for auth + scope.
 *   2. Read every `inbound_messages` row for this user, sorted
 *      newest-first by `received_at`.
 *   3. Render a Table with From / Body / Received at / Status /
 *      Actions columns. Each unread row gets a "Mark read" button;
 *      already-read rows render a "Read" badge in its place.
 *   4. Above the table, a "Mark all read" button flips every unread
 *      row to `read=true` in one server round-trip.
 *   5. When the user has no inbound messages, render the `EmptyState`
 *      primitive so the page mirrors the same empty-state pattern
 *      as the other `/app/*` views.
 *
 * The Mark-read buttons are small client islands that own
 * `useTransition` for the pending state. Each one posts a FormData
 * to the inline server action `markReadAction` declared below.
 */

export const dynamic = "force-dynamic";

interface InboundMessageRow {
  id: number;
  fromPhone: string;
  body: string;
  receivedAt: Date;
  read: boolean;
}

/**
 * Inline server action bound to the per-row Mark read button.
 * Delegates to the exported `markReadAction` in
 * `src/lib/actions/inbox.ts`. Mirrors the
 * `setDefaultSenderIdAction` / `cancelScheduledAction` pattern.
 */
async function markReadFormAction(formData: FormData): Promise<void> {
  "use server";
  const idRaw = formData.get("id");
  if (typeof idRaw !== "string") return;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  await markReadAction({ id });
}

/**
 * Inline server action for the "Mark all read" button at the top of
 * the table. Delegates to `markAllReadAction`.
 */
async function markAllReadFormAction(_formData: FormData): Promise<void> {
  "use server";
  await markAllReadAction();
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export default async function InboxPage() {
  const user = await requireUser();
  const db = getTestDb();

  const rows = await db.select("inbound_messages", { user_id: user.id });
  const messages: InboundMessageRow[] = rows
    .map((r) => ({
      id: r.id as number,
      fromPhone: String(r.from_phone ?? ""),
      body: String(r.body ?? ""),
      receivedAt: (r.received_at as Date | null) ?? new Date(0),
      read: r.read === true,
    }))
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <div className={cn("mx-auto w-full max-w-4xl px-6 py-10")}>
      <header className={cn("mb-8 flex flex-wrap items-end justify-between gap-4")}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Inbox
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Inbound text messages received on your Twilio number.{" "}
            {unreadCount > 0 ? (
              <span data-testid="inbox-unread-count">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {unreadCount}
                </span>{" "}
                unread.
              </span>
            ) : (
              <span data-testid="inbox-unread-count">All caught up.</span>
            )}
          </p>
        </div>
        {unreadCount > 0 ? (
          <form action={markAllReadFormAction} data-testid="inbox-mark-all-form">
            <Button
              type="submit"
              variant="secondary"
              data-testid="inbox-mark-all-button"
            >
              Mark all read
            </Button>
          </form>
        ) : null}
      </header>

      {messages.length === 0 ? (
        <EmptyState
          emoji="📨"
          title="No inbound messages yet"
          description="When someone texts your Twilio number, the message will appear here."
          cta={{ label: "Send a test message", href: "/app/send" }}
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
                <TableHead>From</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Received at</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id} data-testid={`inbox-row-${m.id}`}>
                  <TableCell>
                    <span className="font-mono text-sm">{m.fromPhone}</span>
                  </TableCell>
                  <TableCell>
                    <span className="line-clamp-2 max-w-md text-sm text-zinc-700 dark:text-zinc-300">
                      {m.body}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {formatDate(m.receivedAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {m.read ? (
                      <span
                        data-testid={`inbox-status-${m.id}`}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5",
                          "text-xs font-medium",
                          "bg-zinc-100 text-zinc-600",
                          "dark:bg-zinc-800 dark:text-zinc-400",
                        )}
                      >
                        read
                      </span>
                    ) : (
                      <span
                        data-testid={`inbox-status-${m.id}`}
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5",
                          "text-xs font-medium",
                          "bg-emerald-100 text-emerald-800",
                          "dark:bg-emerald-900/30 dark:text-emerald-300",
                        )}
                      >
                        unread
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {m.read ? (
                      <span className="text-xs text-zinc-400 dark:text-zinc-600">
                        —
                      </span>
                    ) : (
                      <MarkReadButton
                        messageId={m.id}
                        action={markReadFormAction}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}