"use client";

/**
 * Per-row "Cancel" button for /app/scheduled.
 *
 * Owns local state for the in-flight transition (`useTransition`)
 * and any error from the cancel action. The actual server action
 * (`cancelAction`) is passed in from the page so this component
 * stays focused on UI concerns.
 *
 * The button is rendered inline inside the table row; the
 * surrounding `<TableCell>` wraps it with `text-right` so it
 * right-aligns naturally.
 */

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface CancelScheduledButtonProps {
  messageId: number;
  cancelAction: (formData: FormData) => Promise<void>;
}

export function CancelScheduledButton({
  messageId,
  cancelAction,
}: CancelScheduledButtonProps) {
  const [isPending, startTransition] = useTransition();

  function handleSubmit(): void {
    startTransition(async () => {
      // Build a FormData so the existing inline server action shape
      // (`formData.get("messageId")`) keeps working without changes.
      const formData = new FormData();
      formData.set("messageId", String(messageId));
      await cancelAction(formData);
    });
  }

  return (
    <form action={handleSubmit} data-testid={`scheduled-cancel-form-${messageId}`}>
      <input type="hidden" name="messageId" value={messageId} />
      <Button
        type="submit"
        variant="secondary"
        disabled={isPending}
        data-testid={`scheduled-cancel-button-${messageId}`}
        className={cn(isPending && "opacity-60")}
      >
        {isPending ? "Cancelling…" : "Cancel"}
      </Button>
    </form>
  );
}