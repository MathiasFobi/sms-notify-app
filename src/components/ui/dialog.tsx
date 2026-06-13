"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * shadcn/ui-flavoured Dialog.
 *
 * Minimal hand-rolled modal — no Radix dependency, just an
 * overlay + panel + escape/click-outside dismiss. The component
 * is controlled (the `open` prop is the source of truth) and
 * fires `onOpenChange` when the user wants to close it.
 *
 * Render a `Dialog` only when `open` is true so it doesn't
 * accidentally trap focus in the background. The overlay has
 * role="dialog" + aria-modal so screen readers treat it as a
 * modal.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <Dialog open={open} onOpenChange={setOpen} title="Confirm send">
 *     <p>Are you sure?</p>
 *   </Dialog>
 *
 * The `title` prop is required so the dialog always has an
 * accessible label. (For richer labelling pass `aria-label` or
 * a custom children head.)
 */
export type DialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      data-testid="dialog"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-md rounded-lg border border-border",
          "bg-card text-card-foreground shadow-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && (
              <p className="mt-1 text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={() => onOpenChange(false)}
            className={cn(
              "rounded-md p-1 text-muted-foreground hover:bg-accent",
              "hover:text-accent-foreground",
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 text-sm">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border p-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
