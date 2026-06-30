import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal Table UI primitive.
 *
 * Wraps native `<table>` / `<thead>` / `<tbody>` / `<tr>` / `<th>` /
 * `<td>` so callers get a small set of className-controlled styles
 * without bringing in a component library. The classNames are tuned
 * to fit the existing dashboard chrome in `src/app/app/layout.tsx`
 * (zinc-200 borders, zinc-50 header background).
 *
 * Composition model:
 *   <Table>
 *     <TableHeader>
 *       <TableRow>
 *         <TableHead>Sender ID</TableHead>
 *         <TableHead>Status</TableHead>
 *       </TableRow>
 *     </TableHeader>
 *     <TableBody>
 *       <TableRow>
 *         <TableCell>...</TableCell>
 *       </TableRow>
 *     </TableBody>
 *   </Table>
 */

export const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(function Table({ className, ...rest }, ref) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        ref={ref}
        className={cn("w-full caption-bottom text-sm", className)}
        {...rest}
      />
    </div>
  );
});

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableHeader({ className, ...rest }, ref) {
  return (
    <thead
      ref={ref}
      className={cn(
        "border-b border-zinc-200 bg-zinc-50",
        "dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
      {...rest}
    />
  );
});

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(function TableBody({ className, ...rest }, ref) {
  return (
    <tbody
      ref={ref}
      className={cn("[&_tr:last-child]:border-0", className)}
      {...rest}
    />
  );
});

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(function TableRow({ className, ...rest }, ref) {
  return (
    <tr
      ref={ref}
      className={cn(
        "border-b border-zinc-200 transition-colors",
        "hover:bg-zinc-50",
        "dark:border-zinc-800 dark:hover:bg-zinc-900",
        className,
      )}
      {...rest}
    />
  );
});

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(function TableHead({ className, ...rest }, ref) {
  return (
    <th
      ref={ref}
      scope="col"
      className={cn(
        "h-10 px-3 text-left align-middle text-xs font-semibold uppercase tracking-wide",
        "text-zinc-600 dark:text-zinc-400",
        className,
      )}
      {...rest}
    />
  );
});

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(function TableCell({ className, ...rest }, ref) {
  return (
    <td
      ref={ref}
      className={cn("p-3 align-middle", className)}
      {...rest}
    />
  );
});