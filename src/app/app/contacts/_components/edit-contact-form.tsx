"use client";

/**
 * Inline edit form for a single contact on /app/contacts.
 *
 * Mirrors the rename pattern from US-007 (per-row inline form) but
 * adds all mutable contact fields. Submits to `editContactAction`
 * with the row's `id` and the new values. Errors are surfaced
 * inline. On success the form is hidden and the row returns to
 * read-only mode (the parent re-renders after the server action).
 *
 * The `groupOptions` prop carries the user's existing contact
 * groups so the select can be populated. If the user has no groups
 * the select falls back to a plain text input — but in practice the
 * table is rendered AFTER the groups section so this should never
 * happen in the current UI.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { editContactAction } from "@/lib/actions/contacts";
import type { ContactGroupOption } from "./add-contact-form";

export interface EditableContact {
  id: number;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  groupId: number | null;
}

export interface EditContactFormProps {
  contact: EditableContact;
  groups: ContactGroupOption[];
  className?: string;
}

export function EditContactForm({
  contact,
  groups,
  className,
}: EditContactFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const phone = String(formData.get("phone") ?? "").trim();
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const groupRaw = String(formData.get("groupId") ?? "").trim();

    startTransition(async () => {
      try {
        await editContactAction({
          id: contact.id,
          phone: phone.length > 0 ? phone : undefined,
          firstName: firstName,
          lastName: lastName,
          groupId:
            groupRaw.length > 0
              ? Number.parseInt(groupRaw, 10)
              : null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update contact");
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <form
        action={handleSubmit}
        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-5"
      >
        <Input
          name="phone"
          defaultValue={contact.phone}
          aria-label="Phone number"
          required
          disabled={isPending}
          className="sm:col-span-2"
        />
        <Input
          name="firstName"
          defaultValue={contact.firstName ?? ""}
          placeholder="First name"
          aria-label="First name"
          disabled={isPending}
        />
        <Input
          name="lastName"
          defaultValue={contact.lastName ?? ""}
          placeholder="Last name"
          aria-label="Last name"
          disabled={isPending}
        />
        <div className="flex items-center gap-2">
          <select
            name="groupId"
            defaultValue={
              contact.groupId === null ? "" : String(contact.groupId)
            }
            disabled={isPending || groups.length === 0}
            aria-label="Group"
            className={cn(
              "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm shadow-sm",
              "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
            )}
          >
            <option value="">
              {groups.length === 0 ? "(no groups)" : "(no group)"}
            </option>
            {groups.map((g) => (
              <option key={g.id} value={String(g.id)}>
                {g.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
      {error !== null ? (
        <p
          role="alert"
          className="text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}