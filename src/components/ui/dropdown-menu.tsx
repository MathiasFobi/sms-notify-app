"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * shadcn/ui-flavoured DropdownMenu.
 *
 * Hand-rolled (no Radix) — we only need a click-to-open
 * popover with a list of actions. The menu is anchored to its
 * trigger; clicking outside or pressing Escape closes it.
 *
 * Render `<DropdownMenuTrigger asChild><Button>…</Button></DropdownMenuTrigger>`
 * OR use the `label` prop on the trigger for a self-contained
 * button.
 *
 * For more complex menus (keyboard navigation, typeahead,
 * sub-menus) we can replace this with Radix later. For v1 the
 * "click trigger, click outside to close" interaction is enough
 * — the only use in the portal is the user menu in the topbar.
 */
export type DropdownMenuProps = {
  /** Visible label on the trigger button. */
  triggerLabel: React.ReactNode;
  /** Children render as the menu items. */
  children: React.ReactNode;
  /** Optional className on the trigger button. */
  triggerClassName?: string;
  /** Where to anchor the menu relative to the trigger. */
  align?: "start" | "end";
};

export function DropdownMenu({
  triggerLabel,
  children,
  triggerClassName,
  align = "end",
}: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside.
  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-9 items-center justify-center rounded-md border",
          "border-input bg-background px-3 text-sm font-medium",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2",
          "focus-visible:ring-ring focus-visible:ring-offset-2",
          triggerClassName,
        )}
      >
        {triggerLabel}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-50 mt-1 min-w-[10rem] overflow-hidden rounded-md border",
            "border-border bg-popover text-popover-foreground shadow-md",
            align === "end" ? "right-0" : "left-0",
          )}
          onClick={() => setOpen(false)}
        >
          <div className="py-1">{children}</div>
        </div>
      )}
    </div>
  );
}

export type DropdownMenuItemProps = {
  onSelect?: () => void;
  children: React.ReactNode;
  destructive?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onSelect">;

/**
 * Single menu row. Renders a button by default; an `href` is
 * not supported in v1 — wrap a `<Link>` in a custom child if
 * you need navigation.
 */
export function DropdownMenuItem({
  onSelect,
  children,
  destructive,
  className,
  ...props
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "block w-full px-3 py-2 text-left text-sm",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}
