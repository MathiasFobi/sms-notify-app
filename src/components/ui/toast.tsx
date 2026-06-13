"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Toast — shadcn-style notification pop-up.
 *
 * Hand-rolled because we don't need the full Radix toast
 * lifecycle for v1. The contract:
 *
 *   const { toast } = useToast();
 *   toast({ title: "Saved", variant: "success" });
 *
 * A toast auto-dismisses after `duration` ms (default 4000).
 * Toasts are rendered into a fixed container in the top-right
 * corner; up to 5 toasts are visible at once, older toasts are
 * pushed off the bottom of the stack.
 *
 * The provider must wrap any client component that calls
 * `useToast()`. Server components can't show toasts — call a
 * server action that does the mutation, returns a status, and
 * have the client dispatch the toast.
 */
export type ToastVariant = "default" | "success" | "destructive";

export type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastEntry = Required<Omit<ToastInput, "description">> & {
  id: string;
  description?: string;
};

type ToastContextValue = {
  toasts: ToastEntry[];
  toast: (input: ToastInput) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastEntry[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry: ToastEntry = {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? "default",
        duration: input.duration ?? 4000,
      };
      setToasts((current) => [...current, entry].slice(-5));
      if (entry.duration > 0) {
        setTimeout(() => dismiss(id), entry.duration);
      }
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Calling `toast` outside a provider is a developer error.
    // Return a no-op so tests that don't render the provider
    // don't crash.
    return {
      toasts: [],
      toast: () => undefined,
      dismiss: () => undefined,
    };
  }
  return ctx;
}

const variantClasses: Record<ToastVariant, string> = {
  default: "border-border bg-popover text-popover-foreground",
  success: "border-emerald-500/40 bg-emerald-50 text-emerald-900",
  destructive: "border-destructive/40 bg-destructive/10 text-destructive",
};

function ToastViewport() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div
      className={cn(
        "pointer-events-none fixed right-4 top-4 z-[100] flex w-80",
        "flex-col gap-2",
      )}
      aria-live="polite"
      role="status"
    >
      {ctx.toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto rounded-md border p-3 shadow-md",
            variantClasses[t.variant],
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && (
                <p className="mt-1 text-xs opacity-80">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => ctx.dismiss(t.id)}
              className="rounded p-1 opacity-70 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
