import { requireUser } from "@/lib/auth/require-user";
import { getTestDb } from "@/test/db";
import { EmptyState } from "@/components/ui/empty-state";
import { markAllReadAction, markReadAction } from "@/lib/actions/inbox";
import { sendSmsAction } from "@/lib/actions/send";
import { InboxSplit, type InboxThread } from "./_components/inbox-split";

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

  // Sender IDs for the reply box — same source as the Send page.
  const senderIdRows = await db.select("sender_ids", { user_id: user.id });
  const senderIds = senderIdRows
    .map((r) => ({
      id: r.id as number,
      value: String(r.value ?? ""),
      isDefault:
        typeof user.row.twilio_from_number === "string" &&
        r.value === user.row.twilio_from_number,
    }))
    .sort((a, b) => a.id - b.id);

  const defaultFromNumber =
    typeof user.row.twilio_from_number === "string" &&
    user.row.twilio_from_number.length > 0
      ? (user.row.twilio_from_number as string)
      : null;

  return (
    <div>
      <header className="mb-6">
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
      </header>

      {messages.length === 0 ? (
        <EmptyState
          emoji="📨"
          title="No inbound messages yet"
          description="When someone texts your Twilio number, the message will appear here."
          cta={{ label: "Send a test message", href: "/app/send" }}
        />
      ) : (
        <InboxSplit
          threads={messages.map<InboxThread>((m) => ({
            id: m.id,
            fromPhone: m.fromPhone,
            body: m.body,
            receivedAt: m.receivedAt,
            read: m.read,
          }))}
          defaultFromNumber={defaultFromNumber}
          senderIds={senderIds}
          markAllReadAction={async () => {
            "use server";
            await markAllReadAction();
          }}
          markReadAction={markReadAction}
          sendReplyAction={async (args) => {
            "use server";
            return sendSmsAction({
              to: args.to,
              body: args.body,
              fromNumber: args.fromNumber,
            });
          }}
        />
      )}
    </div>
  );
}