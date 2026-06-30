"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Per-row "Mark read" button for the inbox table.
 *
 * This is a small `"use client"` island that wraps a `<form>` posting
 * to the server action passed in as a prop. The page file declares
 * the inline `async function markReadAction(formData)` server action
 * and threads it through to this component — same pattern as
 * `CancelScheduledButton` on `/app/scheduled`.
 *
 * Owns `useTransition()` for the pending state so the button label
 * flips to "Marking…" while the action is in flight. The page
 * re-renders on its own once the action completes (Next.js handles
 * the revalidation for `revalidatePath("/app/inbox")` if the page
 * opts in; we keep this component free of router-specific logic so
 * it can be re-used on any page that surfaces inbound messages).
 */
export interface MarkReadButtonProps {
  messageId: number;
  action: (formData: FormData) => Promise<void>;
}

export function MarkReadButton({ messageId, action }: MarkReadButtonProps) {
  const [pending, startTransition] = React.useTransition();

  const handleSubmit = React.useCallback(
    (formData: FormData) => {
      startTransition(async () => {
        await action(formData);
      });
    },
    [action],
  );

  return (
    <form
      action={handleSubmit}
      data-testid={`inbox-mark-read-form-${messageId}`}
    >
      <input type="hidden" name="id" value={String(messageId)} />
      <Button
        type="submit"
        variant="secondary"
        disabled={pending}
        data-testid={`inbox-mark-read-button-${messageId}`}
      >
        {pending ? "Marking…" : "Mark read"}
      </Button>
    </form>
  );
}