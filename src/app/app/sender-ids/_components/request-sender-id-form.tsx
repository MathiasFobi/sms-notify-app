"use client";

/**
 * Small client component form that calls the `requestSenderIdAction`
 * server action. Wrapped in its own file (with `"use client"`) because
 * Next.js server actions can be invoked from a `<form action={...}>`
 * in a client component but the client component itself can't be a
 * server component.
 *
 * Uses `useTransition` so the submit button shows a "Requesting…"
 * state without blocking the rest of the page. After the action
 * succeeds we refresh the router so the server re-renders the
 * sender-IDs list (the in-memory DB on Vercel is per-function, so
 * the refresh also ensures the freshly-inserted row shows up).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";
import { requestSenderIdAction } from "@/lib/actions/sender-ids";

export interface RequestSenderIdFormProps {
  className?: string;
}

export function RequestSenderIdForm({ className }: RequestSenderIdFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  function handleSubmit(formData: FormData) {
    const value = formData.get("value");
    if (typeof value !== "string" || value.trim().length === 0) {
      // Browser-side validation; the server action also validates.
      return;
    }
    const trimmed = value.trim();
    startTransition(async () => {
      try {
        await requestSenderIdAction({ value: trimmed });
        toast({
          title: "Sender ID registered",
          description: `${trimmed} is now approved and set as your default.`,
          variant: "success",
        });
        router.refresh();
      } catch (err) {
        toast({
          title: "Couldn't register sender ID",
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
        });
      }
    });
  }

  return (
    <form
      action={handleSubmit}
      className={cn("flex w-full max-w-sm items-center gap-2", className)}
    >
      <Input
        name="value"
        placeholder="MyBrand or +15551234567"
        aria-label="Sender ID"
        required
        minLength={1}
        maxLength={32}
        disabled={isPending}
      />
      <Button type="submit" disabled={isPending}>
        {isPending ? "Requesting…" : "Request"}
      </Button>
    </form>
  );
}