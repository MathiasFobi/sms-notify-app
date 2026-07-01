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
import { RequestSenderIdForm } from "./_components/request-sender-id-form";

/**
 * /app/sender-ids — list, request, and set default sender ID for the
 * current user.
 *
 * This is a Server Component. It:
 *   1. Resolves the authenticated user via `requireUser()`.
 *   2. Lists their `sender_ids` rows, with the current default
 *      (`users.twilio_from_number`) marked.
 *   3. Renders a request form (client component) and a "Set default"
 *      button per approved row (form posts to the same page; the
 *      `setDefaultSenderIdAction` server action is bound to a small
 *      inline server-action function defined below).
 */

export const dynamic = "force-dynamic";

interface SenderIdRow {
  id: number;
  value: string;
  status: string;
  createdAt: Date;
}

function statusBadge(status: string): string {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
    case "rejected":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300";
    case "pending":
    default:
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  }
}

async function setDefaultAction(formData: FormData): Promise<void> {
  "use server";
  // Dynamic import keeps the cycle clean — the action file is the
  // single source of truth for set-default logic.
  const { setDefaultSenderIdAction } = await import(
    "@/lib/actions/sender-ids"
  );
  const idRaw = formData.get("id");
  if (typeof idRaw !== "string") return;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  await setDefaultSenderIdAction({ id });
}

export default async function SenderIdsPage() {
  const user = await requireUser();
  const db = getTestDb();

  const senderIdRows = await db.select("sender_ids", { user_id: user.id });
  const dbSenderIds: SenderIdRow[] = senderIdRows
    .map((r) => ({
      id: r.id as number,
      value: String(r.value ?? ""),
      status: String(r.status ?? "pending"),
      createdAt: r.created_at as Date,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const currentDefault = (user.row.twilio_from_number as string | null) ?? null;

  // MOCK-DATA BUILD: Vercel serverless is per-function, so the
  // in-memory `sender_ids` table is wiped between requests. The
  // user's `twilio_from_number` is the only piece that persists
  // (via the `__user-cookie`). We synthesize a "current default"
  // row from the cookie so the user always sees their working
  // sender ID even when the DB-side row is gone. When the real DB
  // lands, drop the synthesis and just trust the table.
  const synthesizedRow: SenderIdRow | null = currentDefault
    ? {
        id: -1,
        value: currentDefault,
        status: "approved",
        createdAt: new Date(0),
      }
    : null;

  // Merge: synthesized row first if it exists, then any DB rows
  // for the same value get de-duped.
  const seen = new Set<string>();
  const senderIds: SenderIdRow[] = [];
  if (synthesizedRow) {
    senderIds.push(synthesizedRow);
    seen.add(synthesizedRow.value);
  }
  for (const r of dbSenderIds) {
    if (seen.has(r.value)) continue;
    senderIds.push(r);
    seen.add(r.value);
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Sender IDs
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Register alphanumeric sender IDs (e.g.{" "}
          <span className="font-mono">MyBrand</span>) or dedicated numbers
          so recipients see who is texting them. Approved IDs can be set
          as your default from-number.
        </p>
      </header>

      <section
        className={cn(
          "mb-8 rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Request a new sender ID
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Mock-data build: requests are auto-approved and set as your
          default on the spot. In production, requests start as{" "}
          <span className="font-medium">pending</span> and move to{" "}
          <span className="font-medium">approved</span> after verification.
        </p>
        <div className="mt-4">
          <RequestSenderIdForm />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Your sender IDs
        </h2>
        {senderIds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No sender IDs yet. Submit a request above to get started.
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
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {senderIds.map((s) => {
                  const isDefault = currentDefault === s.value;
                  return (
                    <TableRow key={s.id} data-testid={`sender-id-row-${s.id}`}>
                      <TableCell>
                        <span className="font-mono text-sm">{s.value}</span>
                        {isDefault ? (
                          <span
                            data-testid={`sender-id-default-${s.id}`}
                            className={cn(
                              "ml-2 inline-flex items-center rounded-full px-2 py-0.5",
                              "text-[10px] font-medium uppercase tracking-wide",
                              "bg-zinc-900 text-white",
                              "dark:bg-zinc-100 dark:text-zinc-900",
                            )}
                          >
                            Default
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5",
                            "text-xs font-medium",
                            statusBadge(s.status),
                          )}
                        >
                          {s.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {s.status === "approved" && !isDefault ? (
                          <form action={setDefaultAction}>
                            <input type="hidden" name="id" value={s.id} />
                            <Button type="submit" variant="secondary">
                              Set default
                            </Button>
                          </form>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}