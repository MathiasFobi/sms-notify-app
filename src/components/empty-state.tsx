import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * EmptyState — the placeholder body for tables and lists that
 * haven't been built out yet (US-003 explicitly calls out
 * "ContactTable, MessagesTable placeholders that say 'Coming
 * soon' for now").
 *
 * Two props:
 *  - `title` — short, sentence-case. Defaults to "Coming soon".
 *  - `description` — one-line explanation. Optional.
 *
 * Plus an optional `children` slot for an action button (e.g.
 * a "Buy credits" CTA) and an optional `icon` React node that
 * sits above the title.
 */
export type EmptyStateProps = {
  title?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  title = "Coming soon",
  description,
  icon,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border",
        "border-dashed border-border bg-muted/30 p-8 text-center",
        className,
      )}
      data-testid="empty-state"
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
