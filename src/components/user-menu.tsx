"use client";

import * as React from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

/**
 * UserMenu — topbar dropdown showing the signed-in user.
 *
 * The trigger is a small button with the user's name and a
 * chevron. Clicking it opens a dropdown with:
 *  - The user's email (read-only)
 *  - A "Sign out" item that submits a server action
 *
 * The component is a client component because the
 * `DropdownMenu` is client-side. The sign-out action is
 * passed in as a prop so the menu doesn't import from
 * `next/navigation` directly — keeps it testable.
 */
export type UserMenuProps = {
  name: string;
  email: string | null;
  signOutAction: (formData: FormData) => Promise<void> | void;
};

export function UserMenu({ name, email, signOutAction }: UserMenuProps) {
  return (
    <DropdownMenu
      triggerLabel={
        <span className="inline-flex items-center gap-1.5">
          <User className="h-4 w-4" />
          <span className="max-w-[10rem] truncate">{name}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </span>
      }
    >
      <div className={cn("px-3 py-2 text-xs text-muted-foreground")}>
        <div className="font-medium text-foreground">{name}</div>
        {email ? <div className="truncate">{email}</div> : null}
      </div>
      <DropdownMenuSeparator />
      <form action={signOutAction}>
        <DropdownMenuItem
          type="submit"
          destructive
          onSelect={() => undefined}
        >
          <LogOut className="mr-2 inline h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </form>
    </DropdownMenu>
  );
}
