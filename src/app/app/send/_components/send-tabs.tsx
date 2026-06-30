"use client";

/**
 * Tab toggle that switches between the single-send and bulk-send
 * forms on `/app/send`.
 *
 * Implemented as a `useState` boolean — no new dependency, per the
 * US-010 implementation note. Each panel is one of the existing
 * forms. We re-mount each form (rather than hiding with `display:
 * none`) so that pending state / file inputs / success banners
 * reset when the user switches tabs — switching tabs is implicitly
 * "start a new send".
 *
 * Three tabs:
 *   - Single send: one recipient, one body
 *   - Bulk send (CSV): N recipients, one body
 *   - Per-recipient: N recipients, each row can have its own body
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import { SendSmsForm } from "./send-form";
import { BulkSendSmsForm } from "./bulk-send-form";
import { PerRecipientSendSmsForm } from "./per-recipient-send-form";

type TabKey = "single" | "bulk" | "per-recipient";

export interface SendTabsProps {
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  defaultFromNumber: string | null;
  className?: string;
}

export function SendTabs({
  senderIds,
  defaultFromNumber,
  className,
}: SendTabsProps) {
  const [tab, setTab] = useState<TabKey>("single");

  return (
    <div className={cn("flex w-full flex-col gap-4", className)}>
      <div
        role="tablist"
        aria-label="Send mode"
        className={cn(
          "inline-flex w-fit flex-wrap rounded-md border border-zinc-200 bg-zinc-50 p-1",
          "dark:border-zinc-800 dark:bg-zinc-900",
        )}
      >
        <TabButton
          active={tab === "single"}
          onClick={() => setTab("single")}
          testId="send-tab-single"
        >
          Single send
        </TabButton>
        <TabButton
          active={tab === "bulk"}
          onClick={() => setTab("bulk")}
          testId="send-tab-bulk"
        >
          Bulk send (CSV)
        </TabButton>
        <TabButton
          active={tab === "per-recipient"}
          onClick={() => setTab("per-recipient")}
          testId="send-tab-per-recipient"
        >
          Per-recipient
        </TabButton>
      </div>

      <div data-testid={`send-panel-${tab}`}>
        {tab === "single" ? (
          <SendSmsForm
            senderIds={senderIds}
            defaultFromNumber={defaultFromNumber}
          />
        ) : tab === "bulk" ? (
          <BulkSendSmsForm
            senderIds={senderIds}
            defaultFromNumber={defaultFromNumber}
          />
        ) : (
          <PerRecipientSendSmsForm
            senderIds={senderIds}
            defaultFromNumber={defaultFromNumber}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
        "dark:focus:ring-zinc-300",
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}