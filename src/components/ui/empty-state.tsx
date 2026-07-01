import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * EmptyState UI primitive.
 *
 * Renders a centered, dashed-border panel used when a list view has no
 * rows to show. Two visual modes:
 *
 *   1. With `emoji` prop: a tinted circle with the emoji, then title +
 *      description + a primary CTA link. Use for the most important
 *      "first time here" moments (empty inbox, no contacts, etc.)
 *
 *   2. Without `emoji`: just the dashed panel with title/description/
 *      action. Use for in-between list states ("no results match this
 *      filter").
 *
 * Backward compatible: existing pages use `<EmptyState title=...
 * description=... action=... />` and still work.
 *
 * Usage:
 *   <EmptyState
 *     emoji="📨"
 *     title="No inbound messages yet"
 *     description="When someone texts your Twilio number, the message will appear here."
 *     cta={{ label: "View send history", href: "/app/send" }}
 *   />
 */
export interface EmptyStateCta {
  label: string;
  href: string;
}

export interface EmptyStateProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional headline rendered above the description. */
  title?: string;
  /** Optional supporting copy below the title. */
  description?: string;
  /** Optional custom action area (e.g. a button or a complex form). */
  action?: React.ReactNode;
  /** Optional emoji shown in a tinted circle above the title. */
  emoji?: string;
  /** Optional one-tap primary CTA. Renders as a pill button below the description. */
  cta?: EmptyStateCta;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    {
      className,
      title,
      description,
      action,
      emoji,
      cta,
      children,
      ...rest
    },
    ref,
  ) {
    const withEmoji = Boolean(emoji);

    return (
      <div
        ref={ref}
        data-testid="empty-state"
        data-with-emoji={withEmoji ? "true" : undefined}
        className={cn(
          "rounded-lg border border-dashed border-zinc-300",
          "dark:border-zinc-700",
          withEmoji
            ? "bg-white/60 dark:bg-zinc-900/40 p-8 sm:p-12"
            : "bg-white p-6",
          "text-center",
          className,
        )}
        {...rest}
      >
        {emoji ? (
          <div
            aria-hidden
            className={cn(
              "mx-auto mb-3 flex h-12 w-12 items-center justify-center",
              "rounded-full bg-zinc-100 dark:bg-zinc-800 text-2xl",
            )}
          >
            {emoji}
          </div>
        ) : null}
        {title ? (
          <p
            className={cn(
              withEmoji
                ? "text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                : "text-sm font-medium text-zinc-700 dark:text-zinc-200",
            )}
          >
            {title}
          </p>
        ) : null}
        {description ? (
          <p
            className={cn(
              "mt-1 text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto",
            )}
          >
            {description}
          </p>
        ) : null}
        {!title && !description && children ? children : null}
        {cta ? (
          <Link
            href={cta.href}
            className={cn(
              "mt-4 inline-flex items-center gap-1.5 px-3 py-1.5",
              "rounded-md text-xs font-medium",
              "bg-zinc-900 text-white hover:bg-zinc-800 transition",
              "dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
            )}
          >
            {cta.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        ) : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    );
  },
);