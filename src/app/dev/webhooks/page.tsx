import { notFound } from "next/navigation";
import { cn } from "@/lib/cn";
import { getTestDb, type TestDb } from "@/test/db";
import { DevWebhookSimulator } from "./_components/dev-webhook-simulator";
import CopyableSid from "./copyable-sid";

/**
 * `/dev/webhooks` — developer-only simulator for the Twilio webhook
 * route handlers (US-014).
 *
 * Why a server component:
 *   - Needs to gate on `NODE_ENV !== 'production'` BEFORE doing
 *     anything else. Calling `notFound()` from `next/navigation`
 *     triggers Next.js's not-found UI (and a 404 response) — which
 *     is exactly what we want when this leaks into a production
 *     build by accident.
 *   - Reads the last 20 messages + message_recipients joined view
 *     server-side so we don't need an extra `/api/...` round-trip
 *     just to populate a "what just happened" panel.
 *
 * Why three separate client forms (in
 * `_components/dev-webhook-simulator.tsx`):
 *   - Each form posts to a different route, with a different shape
 *     and a different set of inputs. Splitting them into small
 *     isolated client components keeps the code easier to read
 *     and lets the `data-testid`s per-form (one suite per AC).
 *
 * Production guard:
 *   - If `NODE_ENV === 'production'`, we short-circuit with
 *     `notFound()` from `next/navigation`. This file is still
 *     tree-shaken into the build (it's a route), but its render
 *     path never runs in production.
 *   - In tests, the override `__setDevWebhooksProductionOverride()`
 *     (exported below) flips the guard so the same render code
 *     path can exercise both branches without re-stubbing
 *     `process.env`.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────┐
 *   │ Banner explaining this is a dev-only page   │
 *   ├─────────────────────────────────────────────┤
 *   │ Status callback form                         │
 *   │ Inbound message form                         │
 *   │ STOP keyword form                            │
 *   ├─────────────────────────────────────────────┤
 *   │ Recent messages + recipients table           │
 *   └─────────────────────────────────────────────┘
 */

export const dynamic = "force-dynamic";

// ============================================================================
// Production guard
// ============================================================================

/**
 * Override hook for tests. Pass `true` to force the production
 * branch (so `notFound()` throws), `false` to force the dev
 * branch (so the page renders the simulator UI), or `null` to fall
 * back to `process.env.NODE_ENV === 'production'`.
 */
let productionOverride: boolean | null = null;

export function __setDevWebhooksProductionOverride(
  value: boolean | null,
): void {
  productionOverride = value;
}

function isProductionNow(): boolean {
  if (productionOverride !== null) return productionOverride;
  return process.env.NODE_ENV === "production";
}

// ============================================================================
// Data loading
// ============================================================================

interface RecentMessageRecipientView {
  messageId: number;
  messageBody: string;
  messageStatus: string;
  fromNumber: string;
  messageTwilioSid: string | null;
  recipientId: number | null;
  recipientPhone: string | null;
  recipientStatus: string | null;
  recipientTwilioSid: string | null;
  createdAt: Date | null;
  sentAt: Date | null;
}

/**
 * Build a joined view of the last N `messages` rows, each paired
 * with the matching `message_recipients` row(s). The shim has no
 * JOIN support, so we do two `select` calls per message and
 * stitch them together in JS. Sorted by `id` descending (newest
 * first) — the shim returns rows in insertion order so this is
 * enough.
 *
 * Exported under `__test` so the page-level test can drive the
 * helper directly without re-implementing the join.
 */
export async function loadRecentMessages(
  db: TestDb,
  limit: number,
): Promise<RecentMessageRecipientView[]> {
  const allMessages = await db.select("messages");
  const sortedMessages = [...allMessages].sort((a, b) => {
    const ai = (a.id as number) ?? 0;
    const bi = (b.id as number) ?? 0;
    return bi - ai;
  });
  const recent = sortedMessages.slice(0, limit);

  const rows: RecentMessageRecipientView[] = [];
  for (const m of recent) {
    const recipientRows = await db.select("message_recipients", {
      message_id: m.id as number,
    });
    if (recipientRows.length === 0) {
      rows.push({
        messageId: m.id as number,
        messageBody: String(m.body ?? ""),
        messageStatus: String(m.status ?? ""),
        fromNumber: String(m.from_number ?? ""),
        messageTwilioSid: (m.twilio_message_sid as string | null) ?? null,
        recipientId: null,
        recipientPhone: null,
        recipientStatus: null,
        recipientTwilioSid: null,
        createdAt: (m.created_at as Date | null) ?? null,
        sentAt: (m.sent_at as Date | null) ?? null,
      });
      continue;
    }
    for (const r of recipientRows) {
      rows.push({
        messageId: m.id as number,
        messageBody: String(m.body ?? ""),
        messageStatus: String(m.status ?? ""),
        fromNumber: String(m.from_number ?? ""),
        messageTwilioSid: (m.twilio_message_sid as string | null) ?? null,
        recipientId: r.id as number,
        recipientPhone: String(r.phone ?? ""),
        recipientStatus: String(r.status ?? ""),
        recipientTwilioSid: (r.twilio_message_sid as string | null) ?? null,
        createdAt: (m.created_at as Date | null) ?? null,
        sentAt: (m.sent_at as Date | null) ?? null,
      });
    }
  }
  return rows;
}

// ============================================================================
// Page
// ============================================================================

export default async function DevWebhooksPage() {
  if (isProductionNow()) {
    notFound();
  }

  const db = getTestDb();
  const recent = await loadRecentMessages(db, 20);

  return (
    <div
      className={cn("mx-auto w-full max-w-4xl px-6 py-10")}
      data-testid="dev-webhooks-page"
      data-env={process.env.NODE_ENV ?? "unknown"}
    >
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Twilio webhook simulator
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Dev-only UI to POST synthetic Twilio payloads at the
          <span className="px-1 font-mono">/api/webhooks/twilio/*</span>
          route handlers. No real provider is involved — the routes
          resolve to the local in-memory DB the same way the
          production webhook handlers will when a real upstream
          starts talking to us.
        </p>
        <p
          className={cn(
            "mt-3 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1",
            "text-xs font-medium text-amber-800",
            "dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
          )}
          data-testid="dev-webhooks-banner"
        >
          Dev only — this page calls{" "}
          <code className="font-mono">notFound()</code> when
          <code className="px-1 font-mono">NODE_ENV=production</code>.
        </p>
      </header>

      <DevWebhookSimulator />

      <section className={cn("mt-10")} data-testid="dev-webhooks-recent">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Recent messages (last 20)
        </h2>
        {recent.length === 0 ? (
          <p
            className={cn(
              "rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500",
              "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
            )}
          >
            No messages yet. Send one via{" "}
            <a className="underline" href="/app/send">
              /app/send
            </a>{" "}
            or fire a status callback above.
          </p>
        ) : (
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-zinc-200 bg-white",
              "dark:border-zinc-800 dark:bg-zinc-950",
            )}
          >
            <table className="w-full caption-bottom text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                <tr>
                  <th className="h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Msg
                  </th>
                  <th className="h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    To
                  </th>
                  <th className="h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Body
                  </th>
                  <th className="h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Status
                  </th>
                  <th className="h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Provider SID
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {recent.map((row) => (
                  <RecentRow
                    key={`${row.messageId}:${row.recipientId ?? "x"}`}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// Row renderer for the recent-messages table.
// ============================================================================

function RecentRow({ row }: { row: RecentMessageRecipientView }) {
  const sid = row.recipientTwilioSid ?? row.messageTwilioSid ?? null;
  return (
    <tr
      className={cn(
        "border-b border-zinc-200 transition-colors hover:bg-zinc-50",
        "dark:border-zinc-800 dark:hover:bg-zinc-900",
      )}
      data-testid={`dev-recent-row-${row.messageId}`}
    >
      <td className="p-3 align-middle font-mono text-xs text-zinc-700 dark:text-zinc-300">
        #{row.messageId}
        {row.recipientId !== null ? (
          <span className="text-zinc-400"> / r{row.recipientId}</span>
        ) : null}
      </td>
      <td className="p-3 align-middle font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {row.recipientPhone ?? "(no recipient)"}
      </td>
      <td className="p-3 align-middle text-sm text-zinc-800 dark:text-zinc-200">
        <span className="line-clamp-2 max-w-md">{row.messageBody}</span>
      </td>
      <td className="p-3 align-middle">
        <div className="flex flex-col gap-0.5">
          <span
            data-testid={`dev-recent-msg-status-${row.messageId}`}
            className="inline-flex w-fit items-center rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
          >
            {row.messageStatus}
          </span>
          {row.recipientStatus !== null &&
          row.recipientStatus !== row.messageStatus ? (
            <span
              data-testid={`dev-recent-recipient-status-${row.recipientId}`}
              className="inline-flex w-fit items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            >
              r: {row.recipientStatus}
            </span>
          ) : null}
        </div>
      </td>
      <td className="p-3 align-middle">
        {sid !== null ? (
          <CopyableSid value={sid} />
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        )}
      </td>
    </tr>
  );
}
