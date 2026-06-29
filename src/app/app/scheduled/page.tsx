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
import { Button } from "@/components/ui/button";
import { cancelScheduledAction } from "@/lib/actions/schedule";
import { CancelScheduledButton } from "./_components/cancel-scheduled-button";

/**
 * /app/scheduled — list the current user's scheduled (and cancelled)
 * messages, with a Cancel control per pending row.
 *
 * Server Component:
 *   1. `requireUser()` for auth + scope.
 *   2. Read every `messages` row for this user where `status` is
 *      either `'scheduled'` (pending) or `'cancelled'` (so the user
 *      can see their own cancellations in the same view). Sent,
 *      failed, and delivered messages belong on the `/app/messages`
 *      page (a later story) — this view is "what's queued and
 *      what did I just cancel".
 *   3. Render a Table with the body, recipient phone, scheduled-for
 *      timestamp, current status, and a Cancel button per
 *      `'scheduled'` row.
 *
 * The Cancel button is a small client component that owns a
 * `useTransition` for the pending state and a local error banner,
 * because Next.js server-action <form action={...}> submissions need
 * a client wrapper to surface the "in flight" / "errored" states.
 */

export const dynamic = "force-dynamic";

interface ScheduledMessageRow {
  id: number;
  body: string;
  to: string;
  scheduledFor: Date | null;
  status: string;
}

/**
 * Inline server action bound to <form action={...}> on the Cancel
 * button. Mirrors the `setDefaultAction` pattern from
 * /app/sender-ids — keeps the "simple page-local mutation" boundary
 * thin. The actual logic lives in `cancelScheduledAction`.
 */
async function cancelAction(formData: FormData): Promise<void> {
  "use server";
  const idRaw = formData.get("messageId");
  if (typeof idRaw !== "string") return;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  await cancelScheduledAction({ messageId: id });
}

function statusBadge(status: string): string {
  switch (status) {
    case "scheduled":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "cancelled":
      return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  // Browser/server locale formatting — keep it readable but
  // deterministic. UTC for test stability; user can read their own
  // timezone in the messages page.
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

export default async function ScheduledPage() {
  const user = await requireUser();
  const db = getTestDb();

  // Pull both 'scheduled' and 'cancelled' messages for this user.
  // The shim's `select` only supports equality, so we fetch each
  // status separately and concatenate.
  const scheduledRows = await db.select("messages", {
    user_id: user.id,
    status: "scheduled",
  });
  const cancelledRows = await db.select("messages", {
    user_id: user.id,
    status: "cancelled",
  });

  const allRows = [...scheduledRows, ...cancelledRows];

  // For each message, look up the recipient phone (single-send scheduled
  // jobs always have exactly one recipient row).
  const messages: ScheduledMessageRow[] = await Promise.all(
    allRows.map(async (r) => {
      const recipients = await db.select("message_recipients", {
        message_id: r.id as number,
      });
      const to =
        recipients.length > 0
          ? String(recipients[0]!.phone ?? "")
          : "(no recipient)";
      return {
        id: r.id as number,
        body: String(r.body ?? ""),
        to,
        scheduledFor: (r.scheduled_for as Date | null) ?? null,
        status: String(r.status ?? "scheduled"),
      };
    }),
  );

  // Newest scheduled-for first; cancelled fall to the bottom by their
  // scheduled_for value. For a real UI we'd add a "cancelled_at"
  // column on messages; for now sort by scheduled_for so the table
  // ordering is at least stable.
  messages.sort((a, b) => {
    const ta = a.scheduledFor?.getTime() ?? 0;
    const tb = b.scheduledFor?.getTime() ?? 0;
    return ta - tb;
  });

  return (
    <div className={cn("mx-auto w-full max-w-4xl px-6 py-10")}>
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Scheduled messages
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Messages you've queued for future delivery. Cancel a row before
          it dispatches to stop it from sending. Need to send a new
          scheduled message? Use the{" "}
          <a
            href="/app/send"
            className="font-medium text-zinc-900 underline dark:text-zinc-100"
          >
            Send page
          </a>{" "}
          (scheduled dispatch is added to the send form in a later story).
        </p>
      </header>

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          No scheduled or cancelled messages yet.
        </p>
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
                <TableHead>To</TableHead>
                <TableHead>Body</TableHead>
                <TableHead>Scheduled for</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((m) => (
                <TableRow key={m.id} data-testid={`scheduled-row-${m.id}`}>
                  <TableCell>
                    <span className="font-mono text-sm">{m.to}</span>
                  </TableCell>
                  <TableCell>
                    <span className="line-clamp-2 max-w-md text-sm text-zinc-700 dark:text-zinc-300">
                      {m.body}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">
                      {formatDate(m.scheduledFor)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      data-testid={`scheduled-status-${m.id}`}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5",
                        "text-xs font-medium",
                        statusBadge(m.status),
                      )}
                    >
                      {m.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.status === "scheduled" ? (
                      <CancelScheduledButton
                        messageId={m.id}
                        cancelAction={cancelAction}
                      />
                    ) : null}
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