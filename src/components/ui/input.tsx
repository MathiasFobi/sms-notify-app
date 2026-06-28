import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal Input primitive — wraps native `<input>` with the project
 * Tailwind styling so server forms don't have to repeat it. Accepts
 * all standard input attributes and forwards refs.
 */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, type = "text", ...rest }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm",
        "placeholder:text-zinc-400",
        "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500",
        "dark:focus:ring-zinc-300",
        className,
      )}
      {...rest}
    />
  );
});