"use client";

/**
 * Minimal Dialog primitive — wraps the native HTML `<dialog>` element
 * with a small open/close state. Used for confirmations and inline
 * rename/delete flows where a modal prompt is needed.
 *
 * Composition model:
 *   <Dialog open={isOpen} onClose={() => setOpen(false)} title="Delete?">
 *     <p>Are you sure?</p>
 *     <DialogActions>
 *       <Button onClick={onCancel}>Cancel</Button>
 *       <Button onClick={onConfirm}>Delete</Button>
 *     </DialogActions>
 *   </Dialog>
 *
 * Notes:
 *   - `open` is uncontrolled: passing `open={true}` on mount opens the
 *     dialog. Pass `onClose` to be notified when the user dismisses
 *     it (Esc key, backdrop click, or calling the imperative close
 *     methods). The parent owns the `open` state.
 *   - Uses the native `<dialog>` element so we get backdrop styling,
 *     focus trap, and Esc-to-close for free.
 *   - The component intentionally does NOT include any of: animations,
 *     portals, size variants. Add those if/when a story needs them.
 */

import * as React from "react";
import { cn } from "@/lib/cn";

export interface DialogProps {
  /** Whether the dialog is currently open. */
  open: boolean;
  /** Called when the dialog should close (Esc, backdrop, cancel button). */
  onClose: () => void;
  /** Heading shown at the top of the dialog. */
  title?: React.ReactNode;
  /** Optional description rendered under the title in muted text. */
  description?: React.ReactNode;
  /** Dialog body content. */
  children?: React.ReactNode;
  /** Extra className for the inner panel. */
  className?: string;
}

export const Dialog = React.forwardRef<HTMLDialogElement, DialogProps>(
  function Dialog(
    { open, onClose, title, description, children, className },
    ref,
  ) {
    const localRef = React.useRef<HTMLDialogElement | null>(null);

    // Imperatively open/close the native dialog in response to the
    // `open` prop. We can't just toggle the `open` attribute because
    // the HTMLDialogElement requires `show()` / `showModal()` /
    // `close()` calls to actually animate and trigger the backdrop.
    React.useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      if (open && !el.open) {
        el.showModal();
      } else if (!open && el.open) {
        el.close();
      }
    }, [open]);

    // Wire up the native `cancel` event (fires on Esc) and the
    // backdrop-click event (which the native dialog reports as a
    // `click` on the dialog itself with `event.target === dialog`).
    React.useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      const onCancel = (): void => {
        onClose();
      };
      const onClick = (event: MouseEvent): void => {
        // The native dialog fires a click on itself when the user
        // clicks the backdrop. The panel content is inside the dialog
        // but clicks on the backdrop bubble up to the dialog element
        // with `event.target === el`.
        if (event.target === el) {
          onClose();
        }
      };
      el.addEventListener("cancel", onCancel);
      el.addEventListener("click", onClick);
      return () => {
        el.removeEventListener("cancel", onCancel);
        el.removeEventListener("click", onClick);
      };
    }, [onClose]);

    return (
      <dialog
        ref={(node) => {
          localRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as React.MutableRefObject<HTMLDialogElement | null>).current = node;
        }}
        className={cn(
          "rounded-lg border border-zinc-200 bg-white p-0 shadow-xl",
          "backdrop:bg-zinc-900/40",
          "dark:border-zinc-700 dark:bg-zinc-950",
          className,
        )}
      >
        <div className="p-6">
          {title ? (
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {description}
            </p>
          ) : null}
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
      </dialog>
    );
  },
);

/**
 * DialogActions — right-aligned row of action buttons. Separated from
 * the body so the layout is consistent across dialogs.
 */
export interface DialogActionsProps {
  children?: React.ReactNode;
  className?: string;
}

export function DialogActions({
  children,
  className,
}: DialogActionsProps): React.ReactElement {
  return (
    <div
      className={cn(
        "mt-6 flex items-center justify-end gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}