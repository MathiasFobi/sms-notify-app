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
import {
  deleteContactGroupAction,
  renameContactGroupAction,
} from "@/lib/actions/contact-groups";
import { CreateContactGroupForm } from "./_components/create-contact-group-form";

/**
 * /app/contacts — manage contact groups (US-007) and (later, US-008)
 * the contacts themselves.
 *
 * For US-007 the page renders:
 *   1. A "Create contact group" form (client component).
 *   2. A table of the user's existing groups with inline rename
 *      (per-row form, inline `<input>`) and delete (per-row button)
 *      actions.
 *   3. A placeholder dashed panel where the contacts table will land
 *      in US-008 — keeps the page renderable and testable while we
 *      wait for that story.
 *
 * Server actions are bound via inline `async function <name>Action`
 * declarations below — Next.js 16 lets you co-locate `"use server"`
 * functions inside a server component file and pass them as
 * `<form action={...}>` props. The actual logic lives in
 * `src/lib/actions/contact-groups.ts` and is exercised directly in
 * the test suite; the wrappers here just translate `FormData` to
 * typed args.
 */

export const dynamic = "force-dynamic";

interface ContactGroupRow {
  id: number;
  name: string;
  createdAt: Date;
}

async function renameAction(formData: FormData): Promise<void> {
  "use server";
  const idRaw = formData.get("id");
  const nameRaw = formData.get("name");
  if (typeof idRaw !== "string" || typeof nameRaw !== "string") return;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  const trimmed = nameRaw.trim();
  if (trimmed.length === 0) return;
  await renameContactGroupAction({ id, name: trimmed });
}

async function deleteAction(formData: FormData): Promise<void> {
  "use server";
  const idRaw = formData.get("id");
  if (typeof idRaw !== "string") return;
  const id = Number.parseInt(idRaw, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  await deleteContactGroupAction({ id });
}

export default async function ContactsPage() {
  const user = await requireUser();
  const db = getTestDb();

  const groupRows = await db.select("contact_groups", { user_id: user.id });
  const groups: ContactGroupRow[] = groupRows
    .map((r) => ({
      id: r.id as number,
      name: String(r.name ?? ""),
      createdAt: r.created_at as Date,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <div className={cn("mx-auto w-full max-w-4xl px-6 py-10")}>
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Contacts
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Organize your recipients into named groups so you can target a
          cohort when sending.
        </p>
      </header>

      {/* ============================================================== */}
      {/* Groups section (US-007)                                        */}
      {/* ============================================================== */}
      <section
        className={cn(
          "mb-8 rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Contact groups
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Create a group, then assign contacts to it from the contacts
          table below.
        </p>
        <div className="mt-4">
          <CreateContactGroupForm />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Your groups
        </h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No contact groups yet. Create one above to get started.
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
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Rename</TableHead>
                  <TableHead className="text-right">Delete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {g.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <form
                        action={renameAction}
                        className="flex items-center justify-end gap-2"
                      >
                        <input type="hidden" name="id" value={g.id} />
                        <input
                          type="text"
                          name="name"
                          defaultValue={g.name}
                          aria-label={`Rename group ${g.name}`}
                          required
                          minLength={1}
                          maxLength={64}
                          className={cn(
                            "h-9 w-44 rounded-md border border-zinc-200 bg-white px-3 text-sm shadow-sm",
                            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
                            "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
                          )}
                        />
                        <Button type="submit" variant="secondary">
                          Rename
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={deleteAction} className="inline">
                        <input type="hidden" name="id" value={g.id} />
                        <Button type="submit" variant="secondary">
                          Delete
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* Contacts section placeholder (filled in by US-008)            */}
      {/* ============================================================== */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Contacts
        </h2>
        <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
          No contacts yet. Contacts will live here once you import or add
          them (coming in a later story).
        </p>
      </section>
    </div>
  );
}