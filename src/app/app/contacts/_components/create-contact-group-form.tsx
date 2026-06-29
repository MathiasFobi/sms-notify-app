"use client";

/**
 * Small client component form that calls the `createContactGroupAction`
 * server action. Wrapped in its own file (with `"use client"`) because
 * Next.js server actions can be invoked from a `<form action={...}>`
 * in a client component but the client component itself can't be a
 * server component.
 *
 * Uses `useTransition` so the submit button shows a "Creating…"
 * state without blocking the rest of the page.
 */

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { createContactGroupAction } from "@/lib/actions/contact-groups";

export interface CreateContactGroupFormProps {
  className?: string;
}

export function CreateContactGroupForm({
  className,
}: CreateContactGroupFormProps) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    const name = formData.get("name");
    if (typeof name !== "string" || name.trim().length === 0) {
      // Browser-side validation; the server action also validates.
      return;
    }
    startTransition(async () => {
      await createContactGroupAction({ name: name.trim() });
      // Reset the form so the user can add another group right away.
      const form = document.querySelector<HTMLFormElement>(
        "form[data-create-contact-group]",
      );
      form?.reset();
    });
  }

  return (
    <form
      action={handleSubmit}
      data-create-contact-group=""
      className={cn("flex w-full max-w-sm items-center gap-2", className)}
    >
      <Input
        name="name"
        placeholder="e.g. Customers, Event attendees"
        aria-label="Contact group name"
        required
        minLength={1}
        maxLength={64}
        disabled={isPending}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create group"}
      </Button>
    </form>
  );
}