"use client";

/**
 * Per-package "Purchase" button for the billing page (`/app/billing`).
 *
 * `startCheckoutAction()` returns a URL pointing at
 * `/api/dev/stripe/confirm?session=<id>`. After the action returns
 * we navigate the browser to that URL via `window.location.assign`
 * (a full GET on the confirm endpoint), which mirrors what real
 * Stripe's hosted checkout does on success.
 *
 * Owns `useTransition()` so the button label flips to "Starting
 * checkout…" while the round-trip is in flight, and surfaces the
 * thrown error in a red banner under the button. Successes don't
 * render anything — the navigation takes over before any UI state
 * can settle.
 *
 * Why a client component: `window.location.assign` is a browser-only
 * API. The button needs to be a client island for the action.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { startCheckoutAction } from "@/lib/actions/billing";

export interface PurchaseButtonProps {
  /** Credit-package size. Resolved on the server (catalog lookup). */
  packageCredits: number;
  /** Display label (defaults to "Purchase"). */
  label?: string;
}

export function PurchaseButton({
  packageCredits,
  label,
}: PurchaseButtonProps) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleClick = React.useCallback((): void => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startCheckoutAction({ packageCredits });
        // Full-page navigation to the (mock) checkout URL. The
        // confirm endpoint handles the credit transfer + redirect
        // back to /app/billing; from here we just hand off control.
        if (typeof window !== "undefined") {
          window.location.assign(result.url);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to start checkout",
        );
      }
    });
  }, [packageCredits]);

  return (
    <div className={cn("flex flex-col items-end gap-1")}>
      <Button
        type="button"
        onClick={handleClick}
        disabled={pending}
        data-testid={`billing-purchase-${packageCredits}`}
      >
        {pending ? "Starting checkout…" : label ?? "Purchase"}
      </Button>
      {error ? (
        <p
          role="alert"
          data-testid={`billing-purchase-error-${packageCredits}`}
          className={cn(
            "text-xs text-rose-600 dark:text-rose-400",
          )}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
