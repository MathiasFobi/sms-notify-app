import Link from "next/link";
import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/auth/require-user";
import { getTestDb } from "@/test/db";
import { SendTabs } from "./_components/send-tabs";

/**
 * /app/send — SMS compose page.
 *
 * Server Component:
 *   1. Resolve the current user via `requireUser()`.
 *   2. Read their `sender_ids` (any status) — the select needs values
 *      even before an admin has approved them; the from-number is
 *      just a label here, the mock provider doesn't care.
 *   3. Read `users.twilio_from_number` so the forms can preselect
 *      the user's current default.
 *   4. Render `<SendTabs senderIds={...} defaultFromNumber={...} />`
 *      which is a client component switching between the single-send
 *      form (`SendSmsForm`) and the bulk-send form (`BulkSendSmsForm`).
 *
 * The actual sends are delegated to `sendSmsAction` in
 * `src/lib/actions/send.ts` and `sendBulkSmsAction` in
 * `src/lib/actions/bulk-send.ts`.
 */

export const dynamic = "force-dynamic";

interface SenderIdRow {
  id: number;
  value: string;
  createdAt: Date;
}

export default async function SendPage() {
  const user = await requireUser();
  const db = getTestDb();

  const senderIdRows = await db.select("sender_ids", { user_id: user.id });
  const dbSenderIds: SenderIdRow[] = senderIdRows
    .map((r) => ({
      id: r.id as number,
      value: String(r.value ?? ""),
      createdAt: r.created_at as Date,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const defaultFromNumber =
    typeof user.row.twilio_from_number === "string" &&
    user.row.twilio_from_number.length > 0
      ? (user.row.twilio_from_number as string)
      : null;

  // MOCK-DATA BUILD: synthesize the current default sender ID from
  // the cookie (the only persistent store) when the in-memory DB
  // row is gone. Matches the same synthesis on the /app/sender-ids
  // page. Drop this when the real DB lands.
  const seen = new Set<string>();
  const senderIds: SenderIdRow[] = [];
  if (defaultFromNumber) {
    senderIds.push({
      id: -1,
      value: defaultFromNumber,
      createdAt: new Date(0),
    });
    seen.add(defaultFromNumber);
  }
  for (const r of dbSenderIds) {
    if (seen.has(r.value)) continue;
    senderIds.push(r);
    seen.add(r.value);
  }

  const senderIdsForForm = senderIds.map((s) => ({
    id: s.id,
    value: s.value,
    isDefault: defaultFromNumber === s.value,
  }));

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Send an SMS
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Send a single SMS through the configured provider, or upload a
          CSV to blast the same body to many recipients. The mock provider
          records the message in-memory and returns a{" "}
          <span className="font-mono">mock_&lt;uuid&gt;</span> provider id.
          Need a sender ID first?{" "}
          <Link
            href="/app/sender-ids"
            className="font-medium text-zinc-900 underline dark:text-zinc-100"
          >
            Register one
          </Link>
          .
        </p>
      </header>

      <section
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <SendTabs
          senderIds={senderIdsForForm}
          defaultFromNumber={defaultFromNumber}
        />
      </section>

      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
        Each send costs 1 credit. Make sure you have credits available —
        visit{" "}
        <Link
          href="/app/billing"
          className="underline"
        >
          Billing
        </Link>{" "}
        to top up (placeholder link — billing page lands in a later story).
      </p>
    </div>
  );
}