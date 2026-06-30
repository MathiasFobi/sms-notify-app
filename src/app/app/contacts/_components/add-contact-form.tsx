"use client";

/**
 * Small client component for adding a contact inline on /app/contacts.
 *
 * Wires `<form action={handleSubmit}>` to a server action call:
 *   - `addContactAction({ phone, firstName, lastName, groupId })`
 *
 * After a successful add the form is reset so the user can paste the
 * next row right away. Errors are surfaced inline so the user can
 * correct the input without losing what they typed.
 *
 * Optional fields:
 *   - firstName / lastName: free text
 *   - groupId: pulled from the user's existing contact groups
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { addContactAction } from "@/lib/actions/contacts";

export interface ContactGroupOption {
  id: number;
  name: string;
}

export interface AddContactFormProps {
  groups: ContactGroupOption[];
  className?: string;
}

export function AddContactForm({ groups, className }: AddContactFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const phone = String(formData.get("phone") ?? "").trim();
    if (phone.length === 0) {
      setError("Phone is required");
      return;
    }
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();
    const groupRaw = String(formData.get("groupId") ?? "").trim();
    const groupId =
      groupRaw.length > 0 ? Number.parseInt(groupRaw, 10) : null;

    startTransition(async () => {
      try {
        await addContactAction({
          phone,
          firstName: firstName.length > 0 ? firstName : undefined,
          lastName: lastName.length > 0 ? lastName : undefined,
          groupId: groupId !== null && Number.isInteger(groupId) && groupId > 0
            ? groupId
            : null,
        });
        const form = document.querySelector<HTMLFormElement>(
          "form[data-add-contact]",
        );
        form?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add contact");
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <form
        action={handleSubmit}
        data-add-contact=""
        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-5"
      >
        <Input
          name="phone"
          placeholder="Phone (e.g. 555-123-4567)"
          aria-label="Phone number"
          required
          disabled={isPending}
          className="sm:col-span-2"
        />
        <Input
          name="firstName"
          placeholder="First name"
          aria-label="First name"
          disabled={isPending}
        />
        <Input
          name="lastName"
          placeholder="Last name"
          aria-label="Last name"
          disabled={isPending}
        />
        <div className="flex items-center gap-2">
          <select
            name="groupId"
            aria-label="Group"
            defaultValue=""
            disabled={isPending || groups.length === 0}
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
            {isPending ? "Adding…" : "Add"}
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