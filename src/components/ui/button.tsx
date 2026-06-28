import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal Button primitive — wraps native `<button>` with project
 * Tailwind styling and a small variant set.
 *
 * Variants:
 *   - "primary" (default): zinc-900 background, white text.
 *   - "secondary": white background with zinc border.
 *
 * Note: this is intentionally simple. Server-action forms use the
 * default `type="submit"`; pass `type="button"` for click handlers.
 */
export type ButtonVariant = "primary" | "secondary";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-zinc-900 text-white hover:bg-zinc-800",
    "dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200",
  ),
  secondary: cn(
    "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50",
    "dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
  ),
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "primary", type = "button", ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium",
          "transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "dark:focus:ring-zinc-300",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...rest}
      />
    );
  },
);