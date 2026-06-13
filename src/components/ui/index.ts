/**
 * Barrel export for shadcn-style UI primitives.
 *
 * Importing from `@/components/ui` keeps call sites short
 * (`import { Button, Card } from "@/components/ui"`) and
 * makes it easy to swap a primitive (e.g. swap a hand-rolled
 * Dialog for Radix) without touching every consumer.
 *
 * Each component lives in its own file so the bundler can
 * tree-shake unused primitives.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./button";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";
export { Input, type InputProps } from "./input";
export { Label, type LabelProps } from "./label";
export { Sidebar, navItems, type SidebarProps, type SidebarNavItem } from "./sidebar";
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./table";
export { Dialog, type DialogProps } from "./dialog";
export {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  type DropdownMenuProps,
  type DropdownMenuItemProps,
} from "./dropdown-menu";
export {
  ToastProvider,
  useToast,
  type ToastInput,
  type ToastVariant,
} from "./toast";
