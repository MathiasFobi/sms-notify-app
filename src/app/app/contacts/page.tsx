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
import { AddContactForm } from "./_components/add-contact-form";
import { ImportContactsForm } from "./_components/import-contacts-form";
import { ContactRow } from "./_components/contact-row";

/**
 * /app/contacts — manage contact groups (US-007) and contacts
 * (US-008) for the current user.
 *
 * Renders two stacked sections:
 *   1. Contact groups — create / rename / delete.
 *   2. Contacts — add one at a time, upload a CSV, download the
 *      full list as CSV, and edit / delete individual rows.
 *
 * Server actions for the groups section are bound via inline
 * `async function <name>Action` declarations (Next.js 16 pattern).
 * The contacts section uses client component rows for the
 * per-row edit toggle so we can keep the page itself a Server
 * Component (no need to ship the whole contacts table to the
 * browser just to toggle a "Save" button).
 */

export const dynamic = "force-dynamic";

interface ContactGroupRow {
  id: number;
  name: string;
  createdAt: Date;
}

interface ContactRowShape {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  groupId: number | null;
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

  const contactRows = await db.select("contacts", { user_id: user.id });
  const contacts: ContactRowShape[] = contactRows
    .map((r) => ({
      id: r.id as number,
      phone: String(r.phone ?? ""),
      firstName: (r.first_name as string | null) ?? null,
      lastName: (r.last_name as string | null) ?? null,
      groupId:
        r.group_id === null || r.group_id === undefined
          ? null
          : (r.group_id as number),
      createdAt: r.created_at as Date,
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const groupNameById = new Map<number, string>(
    groups.map((g) => [g.id, g.name]),
  );

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
      {/* Contacts section (US-008)                                      */}
      {/* ============================================================== */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Contacts
        </h2>

        <div
          className={cn(
            "mb-4 rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Add a contact
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Type a phone number; we'll normalize it to E.164 and reject
            duplicates.
          </p>
          <div className="mt-4">
            <AddContactForm
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
            />
          </div>
        </div>

        <div
          className={cn(
            "mb-4 rounded-lg border border-zinc-200 bg-white p-5",
            "dark:border-zinc-800 dark:bg-zinc-950",
          )}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Bulk import / export
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
            Upload a CSV with columns{" "}
            <span className="font-mono">phone,firstName,lastName,groupId</span>{" "}
            or download your current contacts.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ImportContactsForm />
            <a
              href="/api/contacts/export"
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium",
                "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50",
                "dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
              )}
            >
              Download CSV
            </a>
          </div>
        </div>

        {contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            No contacts yet. Add one above or upload a CSV to get started.
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
                  <TableHead>Phone</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={{
                      id: c.id,
                      phone: c.phone,
                      firstName: c.firstName,
                      lastName: c.lastName,
                      groupId: c.groupId,
                    }}
                    groupName={
                      c.groupId === null ? null : groupNameById.get(c.groupId) ?? null
                    }
                    groups={groups.map((g) => ({ id: g.id, name: g.name }))}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}