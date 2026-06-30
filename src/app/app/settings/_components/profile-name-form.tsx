"use client";

/**
 * "Profile name" client form (`/app/settings`).
 *
 * Small `"use client"` island that owns the pending state and
 * surfaces server errors inline. Mirrors the
 * `RequestSenderIdForm` pattern — server actions live in
 * `src/lib/actions/settings.ts` and are imported directly.
 *
 * On success: shows a green confirmation banner, leaves the
 * input populated with the trimmed value the server returned
 * (so the user can see exactly what was stored), and re-enables
 * the field. On error: red banner with the server message.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { updateProfileAction } from "@/lib/actions/settings";

export interface ProfileNameFormProps {
  /** Current display name for the user (server-rendered into the input). */
  currentName: string;
  className?: string;
}

export function ProfileNameForm({ currentName, className }: ProfileNameFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    if (name.trim().length === 0) {
      setError("Display name is required.");
      return;
    }
    setError(null);
    setSavedName(null);
    startTransition(async () => {
      try {
        const result = await updateProfileAction({ name });
        setSavedName(result.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update profile");
      }
    });
  }

  return (
    <form
      id="settings-profile-name-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-md flex-col gap-3", className)}
    >
      {error ? (
        <div
          role="alert"
          data-testid="settings-profile-name-error"
          className={cn(
            "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700",
            "dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
          )}
        >
          {error}
        </div>
      ) : null}
      {savedName && !error ? (
        <div
          role="status"
          data-testid="settings-profile-name-saved"
          className={cn(
            "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
            "dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          Saved.
        </div>
      ) : null}

      <label
        htmlFor="settings-profile-name"
        className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
      >
        Display name
      </label>
      <Input
        id="settings-profile-name"
        name="name"
        type="text"
        defaultValue={currentName}
        placeholder="Your display name"
        aria-label="Display name"
        disabled={isPending}
        required
        maxLength={120}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}