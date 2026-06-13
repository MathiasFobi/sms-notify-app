import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * shadcn/ui-flavoured Button.
 *
 * Variant + size are picked via the `variant` and `size` props so
 * call sites stay readable. The `asChild` prop is intentionally
 * omitted in v1 — we only render `<button>`; later stories that
 * need link-styled buttons can add it.
 *
 * Variants:
 *  - default: zinc-900 fill (primary action)
 *  - secondary: zinc-100 fill (cancel / secondary)
 *  - outline: bordered, transparent fill
 *  - ghost: no background until hover
 *  - destructive: red, for dangerous actions (delete, sign out)
 *  - link: underlined text
 *
 * Sizes: sm, default, lg, icon.
 */
export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "link";

export type ButtonSize = "sm" | "default" | "lg" | "icon";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground hover:opacity-90 active:opacity-80",
  secondary:
    "bg-secondary text-secondary-foreground hover:opacity-90 active:opacity-80",
  outline:
    "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90 active:opacity-80",
  link: "text-primary underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  default: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-sm",
  icon: "h-9 w-9 p-0",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "disabled:pointer-events-none disabled:opacity-50 " +
  "[&_svg]:size-4 [&_svg]:shrink-0";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant = "default", size = "default", type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          baseClasses,
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);
