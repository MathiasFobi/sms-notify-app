import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * shadcn/ui-flavoured Label.
 *
 * Just a styled <label> element. Pair with `<Input htmlFor="...">`
 * to wire up the form-field association. The component is
 * forwardRef.
 */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn(
          "text-sm font-medium leading-none",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className,
        )}
        {...props}
      />
    );
  },
);
