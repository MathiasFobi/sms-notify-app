"use client";

/**
 * Per-row component for /app/contacts that toggles between a
 * read-only display and the inline edit form (US-008).
 *
 * Owns the local `isEditing` state. "Edit" toggles into edit mode;
 * "Cancel" toggles back without persisting. Delete is a separate
 * per-row form bound to the server action (no JS toggle needed
 * there).
 *
 * The row is rendered inside a server-component table, so its
 * `defaultExpanded` prop is honored for the first render but
 * state changes are local to this client component.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { deleteContactAction } from "@/lib/actions/contacts";
import { EditContactForm, type EditableContact } from "./edit-contact-form";
import type { ContactGroupOption } from "./add-contact-form";

export interface ContactRowProps {
  contact: EditableContact;
  groupName: string | null;
  groups: ContactGroupOption[];
}

export function ContactRow({ contact, groupName, groups }: ContactRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDelete(): void {
    setDeleteError(null);
    startDelete(async () => {
      try {
        await deleteContactAction({ id: contact.id });
      } catch (err) {
        setDeleteError(
          err instanceof Error ? err.message : "Failed to delete contact",
        );
      }
    });
  }

  if (isEditing) {
    return (
      <tr className="border-b border-zinc-200 dark:border-zinc-800">
        <td colSpan={4} className="p-3 align-top">
          <div className="flex flex-col gap-2">
            <EditContactForm contact={contact} groups={groups} />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-zinc-200 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <td className="p-3 align-top">
        <div className="flex flex-col">
          <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
            {contact.phone}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            {(contact.firstName ?? "") + (contact.firstName && contact.lastName ? " " : "") + (contact.lastName ?? "") || (
              <span className="italic">(no name)</span>
            )}
          </span>
        </div>
      </td>
      <td className="p-3 align-top">
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          {groupName ?? <span className="italic text-zinc-400">—</span>}
        </span>
      </td>
      <td className="p-3 text-right align-top">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsEditing(true)}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
        {deleteError !== null ? (
          <p
            role="alert"
            className={cn(
              "mt-1 text-xs font-medium text-rose-700 dark:text-rose-300",
            )}
          >
            {deleteError}
          </p>
        ) : null}
      </td>
    </tr>
  );
}