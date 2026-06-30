"use client";

/**
 * `<CopyableSidButton value="SM...">` — copy a Twilio MessageSid /
 * provider message id to the clipboard with one click.
 *
 * Used in the `/dev/webhooks` recent-messages table so devs can grab
 * a sid without selecting it cell-by-cell. Rendered as a server→client
 * island: the parent table cell passes `value` in directly, the
 * button handles its own `copied` flash state.
 *
 * Behavior:
 *   - `navigator.clipboard.writeText()` is the modern, async path.
 *     It requires a secure context (which `localhost` provides in
 *     dev) and falls back to a `<textarea>` + `document.execCommand`
 *     trick when the modern API isn't available (older browsers,
 *     non-HTTPS dev tunnels).
 *   - On success, the button label flashes "Copied!" for 1.5s and
 *     then resets. Multiple rapid clicks reset the timer.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface CopyableSidButtonProps {
  value: string;
  className?: string;
}

const FLASH_DURATION_MS = 1500;

export default function CopyableSidButton({
  value,
  className,
}: CopyableSidButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reset any pending timer when the component unmounts so we don't
    // call setState on an unmounted component.
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  async function handleCopy(): Promise<void> {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== "undefined") {
        // Fallback for non-secure contexts: a hidden textarea +
        // execCommand("copy"). This is the legacy path that
        // basically works everywhere we deploy in dev.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } else {
        // Node / SSR — no clipboard, no-op. UI just shows "Copy"
        // but doesn't change state. Not worth crashing for.
        return;
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, FLASH_DURATION_MS);
    } catch {
      // Clipboard write can fail if the user denied permission or
      // the browser blocked it — fall through silently. The button
      // label will simply stay "Copy" rather than flash "Copied!".
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid="copy-sid-button"
      data-copied={copied ? "true" : "false"}
      data-value={value}
      aria-label={`Copy ${value} to clipboard`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]",
        "transition-colors",
        copied
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
        className,
      )}
    >
      <span className="max-w-[180px] truncate" title={value}>
        {value}
      </span>
      <span aria-hidden="true">{copied ? "✓" : "📋"}</span>
    </button>
  );
}
