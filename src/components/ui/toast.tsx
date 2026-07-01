"use client";

/**
 * Tiny toast notification system.
 *
 * Single-file: a context provider + a `useToast()` hook + a portal
 * that renders the toasts in the bottom-right of the screen.
 *
 * Why not a library? The existing form components handle their own
 * success/error banners inline (which is fine for the form context).
 * A library like sonner/react-hot-toast would add 10+kb for a feature
 * we use lightly. A 100-line in-house implementation is enough.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast({ title: "Sent!", description: "12 messages delivered", variant: "success" });
 *   toast({ title: "Failed", variant: "error" });
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  /** Auto-dismiss timeout in ms. Default 4000. Set to 0 to disable. */
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Outside a provider — return a no-op so callers don't crash.
    // Useful for tests and the rare server-rendered tree branch.
    return {
      toasts: [],
      toast: () => "",
      dismiss: () => undefined,
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<ToastContextValue["toast"]>((t) => {
    const id = Math.random().toString(36).slice(2, 10);
    setToasts((curr) => [...curr, { ...t, id }]);
    const duration = t.duration ?? 4000;
    if (duration > 0) {
      const handle = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, handle);
    }
    return id;
  }, [dismiss]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      t.forEach((handle) => clearTimeout(handle));
      t.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const Icon =
    toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "error"
        ? XCircle
        : Info;

  const accent =
    toast.variant === "success"
      ? "border-emerald-200/60 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300"
      : toast.variant === "error"
        ? "border-rose-200/60 dark:border-rose-900/40 text-rose-700 dark:text-rose-300"
        : "border-cyan-200/60 dark:border-cyan-900/40 text-cyan-700 dark:text-cyan-300";

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 w-72 sm:w-80",
        "rounded-lg border bg-white/95 dark:bg-zinc-900/95 backdrop-blur shadow-lg",
        "p-3 pr-2 animate-fade-up",
        accent,
      )}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {toast.title}
        </p>
        {toast.description ? (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 break-words">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="p-1 -m-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition shrink-0"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}