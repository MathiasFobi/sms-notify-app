import { cn } from "@/lib/cn";
import { requireUser } from "@/lib/auth/require-user";
import { getTestDb } from "@/test/db";
import { ProfileNameForm } from "./_components/profile-name-form";
import { DefaultSenderIdForm } from "./_components/default-sender-id-form";

/**
 * /app/settings — the user's account settings page.
 *
 * Server Component:
 *   1. `requireUser()` for auth + scope.
 *   2. Read the current user (display name + default sender ID).
 *   3. Read the user's APPROVED sender IDs to populate the
 *      default-sender-ID `<select>`.
 *   4. Render two client forms:
 *      - ProfileNameForm (current name -> editable input)
 *      - DefaultSenderIdForm (current default -> `<select>`
 *        of approved sender IDs)
 *
 * The page does NOT export a `page.test.tsx` for unit-testability
 * directly — the form components are tested in isolation through
 * the action layer, and the page-level rendering is covered by
 * the page.test.tsx that ships with this story (see
 * `page.test.tsx`). The test uses `renderToStaticMarkup` against
 * the page module just like the other /app/* pages.
 */

export const dynamic = "force-dynamic";

interface SenderIdRow {
  id: number;
  value: string;
  status: string;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const db = getTestDb();

  // Pull the user's approved sender IDs for the default-sender-id
  // <select>. The shim's `select` only supports equality, so we
  // filter by status in JS after reading the user's rows.
  const allSenderRows = await db.select("sender_ids", { user_id: user.id });
  const approvedSenderIds: SenderIdRow[] = allSenderRows
    .filter((r) => r.status === "approved")
    .map((r) => ({
      id: r.id as number,
      value: String(r.value ?? ""),
      status: String(r.status ?? "approved"),
    }))
    .sort((a, b) => a.value.localeCompare(b.value));

  const currentName = String(user.row.name ?? "");
  const currentDefault =
    (user.row.twilio_from_number as string | null) ?? null;

  return (
    <div className={cn("mx-auto w-full max-w-4xl px-6 py-10")}>
      <header className={cn("mb-8")}>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Manage your display name and default sender ID used by single sends.
        </p>
      </header>

      <section
        className={cn(
          "mb-8 rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
        data-testid="settings-profile-section"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Profile
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          This name is shown across the dashboard wherever your account is
          referenced.
        </p>
        <div className="mt-4">
          <ProfileNameForm currentName={currentName} />
        </div>
      </section>

      <section
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-5",
          "dark:border-zinc-800 dark:bg-zinc-950",
        )}
        data-testid="settings-default-sender-id-section"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Default sender ID
        </h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
          Used by single sends when no explicit &ldquo;from&rdquo; is
          chosen. Approved sender IDs only.
        </p>
        <div className="mt-4">
          <DefaultSenderIdForm
            approvedSenderIds={approvedSenderIds}
            currentDefault={currentDefault}
          />
        </div>
      </section>
    </div>
  );
}