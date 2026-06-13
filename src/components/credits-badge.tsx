import { Coins } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * CreditsBadge — server component.
 *
 * Renders the user's current credit balance in the topbar. The
 * balance is passed in as a prop rather than queried inside the
 * component so:
 *
 *  - The parent server component is the one that hits the DB,
 *    keeping this component purely presentational.
 *  - The same balance can be reused for the "Credits balance"
 *    stat card on the dashboard without two queries.
 *  - The component is trivially testable: render with a number
 *    and assert the markup.
 *
 * The icon is the lucide `Coins` glyph in a soft amber circle —
 * a friendly visual cue that distinguishes the badge from the
 * user's name in the topbar.
 */
export function CreditsBadge({ credits, className }: { credits: number; className?: string }) {
  const display = Number.isFinite(credits) ? Math.max(0, Math.trunc(credits)) : 0;
  return (
    <div
      data-testid="credits-badge"
      data-credits={display}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border",
        "bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900",
        "dark:bg-amber-400/10 dark:text-amber-300",
        className,
      )}
      aria-label={`Credit balance: ${display}`}
    >
      <Coins className="h-3.5 w-3.5" aria-hidden />
      <span data-testid="credits-badge-value">{display.toLocaleString()}</span>
      <span className="text-amber-700/70 dark:text-amber-300/70">credits</span>
    </div>
  );
}
