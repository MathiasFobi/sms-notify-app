"use client";

/**
 * "Default sender ID" client form (`/app/settings`).
 *
 * Small `"use client"` island that renders a `<select>` populated
 * with the user's APPROVED sender IDs plus an "No default" option
 * (empty value, which the server interprets as `null`).
 *
 * The current default (`users.twilio_from_number`) is preselected.
 * On submit, the chosen `senderIdRowId` is sent to
 * `updateDefaultSenderIdAction`. The empty option triggers the
 * null-clearing branch — same action, no separate "clear default"
 * button needed.
 *
 * Mirrors `ProfileNameForm`: pending state, inline success/error
 * banners, and a confirm button whose label flips to "Saving…"
 * during the transition.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { updateDefaultSenderIdAction } from "@/lib/actions/settings";

export interface DefaultSenderIdFormProps {
  /** The user's APPROVED sender IDs (already filtered server-side). */
  approvedSenderIds: Array<{ id: number; value: string }>;
  /** The current `users.twilio_from_number`, if any. */
  currentDefault: string | null;
  className?: string;
}

export function DefaultSenderIdForm({
  approvedSenderIds,
  currentDefault,
  className,
}: DefaultSenderIdFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedDefault, setSavedDefault] = useState<string | null>(null);

  // The select's initial value tracks the row id whose `value`
  // matches the user's current default. Falls back to "" (no
  // default) when nothing matches — e.g. the user has cleared
  // the default, or the current default was a number that has
  // since been removed from the approved set.
  const initialRowId = approvedSenderIds.find(
    (s) => s.value === currentDefault,
  )?.id;

  function handleSubmit(formData: FormData) {
    const raw = formData.get("senderIdRowId");
    let senderId: number | null;
    if (typeof raw !== "string" || raw === "") {
      senderId = null;
    } else {
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("Please choose a valid sender ID.");
        return;
      }
      senderId = parsed;
    }
    setError(null);
    setSavedDefault(null);
    startTransition(async () => {
      try {
        const result = await updateDefaultSenderIdAction({ senderId });
        setSavedDefault(result.twilioFromNumber);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update default");
      }
    });
  }

  return (
    <form
      id="settings-default-sender-id-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-md flex-col gap-3", className)}
    >
      {error ? (
        <div
          role="alert"
          data-testid="settings-default-sender-id-error"
          className={cn(
            "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700",
            "dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
          )}
        >
          {error}
        </div>
      ) : null}
      {savedDefault !== null && !error ? (
        <div
          role="status"
          data-testid="settings-default-sender-id-saved"
          className={cn(
            "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
            "dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          Default updated.
        </div>
      ) : null}

      <label
        htmlFor="settings-default-sender-id"
        className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
      >
        Default sender ID
      </label>
      {approvedSenderIds.length === 0 ? (
        <p
          className={cn(
            "rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-500",
            "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
          )}
        >
          You don&apos;t have any approved sender IDs yet. Visit{" "}
          <a className="underline" href="/app/sender-ids">
            Sender IDs
          </a>{" "}
          to request one.
        </p>
      ) : (
        <>
          <select
            id="settings-default-sender-id"
            name="senderIdRowId"
            defaultValue={
              initialRowId !== undefined ? String(initialRowId) : ""
            }
            disabled={isPending}
            className={cn(
              "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm",
              "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
            )}
          >
            <option value="">No default</option>
            {approvedSenderIds.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.value}
              </option>
            ))}
          </select>
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}