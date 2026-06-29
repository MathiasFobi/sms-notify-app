import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal EmptyState UI primitive.
 *
 * Renders a centered, dashed-border panel used when a list view has
 * no rows to show. Matches the inline empty-state styling already
 * used across `/app/sender-ids`, `/app/scheduled`, and `/app/contacts`
 * — centralizing it here so future pages can drop the same component
 * in without duplicating the long Tailwind className string.
 *
 * Usage:
 *   <EmptyState
 *     title="No inbound messages yet"
 *     description="When someone texts your Twilio number, the message will appear here."
 *   />
 *
 * Or, for plain text-only empty states (no header / no description):
 *   <EmptyState>No sender IDs yet. Submit a request above to get started.</EmptyState>
 */
export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional headline rendered above the description. */
  title?: string;
  /** Optional supporting copy below the title. */
  description?: string;
  /** Optional CTA / action area (e.g. a link to a creation form). */
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    { className, title, description, action, children, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-testid="empty-state"
        className={cn(
          "rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500",
          "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
          className,
        )}
        {...rest}
      >
        {title ? (
          <p
            className={cn(
              "text-sm font-medium text-zinc-700 dark:text-zinc-200",
            )}
          >
            {title}
          </p>
        ) : null}
        {description ? (
          <p
            className={cn(
              "mt-1 text-sm text-zinc-500 dark:text-zinc-400",
            )}
          >
            {description}
          </p>
        ) : null}
        {!title && !description && children ? children : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    );
  },
);