"use client";

/**
 * Split-pane inbox for the /app/inbox page.
 *
 * Layout (desktop, md+):
 *   ┌─────────────┬──────────────────────────┐
 *   │             │                          │
 *   │  thread     │      thread detail       │
 *   │  list       │      (selected message)  │
 *   │             │                          │
 *   │  (left)     │      (right)             │
 *   │             │                          │
 *   └─────────────┴──────────────────────────┘
 *
 * Layout (mobile, <md):
 *   - Either the list OR the detail is shown at a time.
 *   - Tapping a row in the list navigates to the detail view with a
 *     back button.
 *
 * Features:
 *   - List rows show: phone, body preview (1 line), relative time,
 *     unread indicator (cyan dot).
 *   - Detail shows: full phone, full body, received at, mark-read
 *     action, and a reply box that posts to sendSmsAction.
 *   - Mark-all-read action runs on the parent and refreshes the list.
 *   - Replies trigger a toast on success/failure (uses the global
 *     ToastProvider from the layout).
 *
 * The component is fully client-rendered and receives the message
 * list as a prop. Mutations (mark read, send reply) invalidate the
 * page via `router.refresh()`.
 */

import { useState, useTransition, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, CheckCheck, Mail, Reply, Send, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/toast";

export interface InboxThread {
  id: number;
  fromPhone: string;
  body: string;
  receivedAt: Date | string;
  read: boolean;
}

export interface InboxSplitProps {
  threads: InboxThread[];
  defaultFromNumber: string | null;
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  markAllReadAction: () => Promise<void>;
  markReadAction: (args: { id: number }) => Promise<{ id: number }>;
  sendReplyAction: (args: {
    to: string;
    body: string;
    fromNumber?: string;
  }) => Promise<unknown>;
}

type TabFilter = "all" | "unread";

function formatTime(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  const now = new Date();
  const diffMs = now.getTime() - dt.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFull(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function InboxSplit({
  threads,
  defaultFromNumber,
  senderIds,
  markAllReadAction,
  markReadAction,
  sendReplyAction,
}: InboxSplitProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<TabFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(
    threads.find((t) => !t.read)?.id ?? threads[0]?.id ?? null
  );
  const [markAllPending, startMarkAll] = useTransition();
  const [markOnePending, startMarkOne] = useTransition();
  const [replyPending, startReply] = useTransition();
  const [replyBody, setReplyBody] = useState("");
  const [replyFrom, setReplyFrom] = useState<string>(
    defaultFromNumber ??
      senderIds.find((s) => s.isDefault)?.value ??
      senderIds[0]?.value ??
      ""
  );

  // Update default `from` when sender list changes.
  useEffect(() => {
    if (replyFrom) return;
    setReplyFrom(
      defaultFromNumber ??
        senderIds.find((s) => s.isDefault)?.value ??
        senderIds[0]?.value ??
        ""
    );
  }, [senderIds, defaultFromNumber, replyFrom]);

  const filtered = useMemo(
    () => (filter === "unread" ? threads.filter((t) => !t.read) : threads),
    [filter, threads]
  );

  const selected = useMemo(
    () => threads.find((t) => t.id === selectedId) ?? null,
    [threads, selectedId]
  );

  const unreadCount = threads.filter((t) => !t.read).length;

  function handleSelect(id: number) {
    setSelectedId(id);
    const t = threads.find((x) => x.id === id);
    if (t && !t.read) {
      startMarkOne(async () => {
        try {
          await markReadAction({ id });
          router.refresh();
        } catch (err) {
          toast({
            title: "Couldn't mark as read",
            description: err instanceof Error ? err.message : String(err),
            variant: "error",
          });
        }
      });
    }
  }

  function handleMarkAll() {
    startMarkAll(async () => {
      try {
        await markAllReadAction();
        router.refresh();
        toast({ title: "All caught up", description: "Marked all messages as read.", variant: "success" });
      } catch (err) {
        toast({
          title: "Couldn't mark all as read",
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
        });
      }
    });
  }

  function handleSendReply() {
    if (!selected) return;
    const body = replyBody.trim();
    if (!body) return;
    startReply(async () => {
      try {
        await sendReplyAction({
          to: selected.fromPhone,
          body,
          fromNumber: replyFrom || undefined,
        });
        setReplyBody("");
        toast({ title: "Reply sent", description: `To ${selected.fromPhone}`, variant: "success" });
      } catch (err) {
        toast({
          title: "Reply failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "error",
        });
      }
    });
  }

  return (
    <div className="grid md:grid-cols-[320px_1fr] gap-4 h-[calc(100vh-220px)] min-h-[500px]">
      {/* ----- Thread list (left rail) ----------------------------------- */}
      <aside
        className={cn(
          "flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-950",
          "min-h-0 overflow-hidden",
          // Mobile: hide when something is selected
          selected && "hidden md:flex",
        )}
        data-testid="inbox-thread-list"
      >
        <div className="flex items-center gap-1 p-2 border-b border-zinc-200 dark:border-zinc-800">
          <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-900/50 flex-1">
            <button
              type="button"
              onClick={() => setFilter("all")}
              data-testid="inbox-filter-all"
              className={cn(
                "flex-1 px-2 py-1 text-xs font-medium rounded transition",
                filter === "all"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              All ({threads.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              data-testid="inbox-filter-unread"
              className={cn(
                "flex-1 px-2 py-1 text-xs font-medium rounded transition",
                filter === "unread"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              Unread ({unreadCount})
            </button>
          </div>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={markAllPending}
              data-testid="inbox-mark-all"
              className="inline-flex items-center px-2 py-1 text-xs font-medium rounded text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition disabled:opacity-50"
              title="Mark all as read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {filter === "unread" ? "No unread messages." : "No messages yet."}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(t.id)}
                    data-testid={`inbox-thread-row-${t.id}`}
                    className={cn(
                      "w-full text-left px-3 py-3 transition",
                      "hover:bg-zinc-50 dark:hover:bg-zinc-900/40",
                      selectedId === t.id && "bg-cyan-50/60 dark:bg-cyan-950/20",
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {!t.read ? (
                        <span
                          className="shrink-0 h-2 w-2 rounded-full bg-cyan-500"
                          aria-label="Unread"
                        />
                      ) : (
                        <span className="shrink-0 h-2 w-2" />
                      )}
                      <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate">
                        {t.fromPhone}
                      </span>
                      <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
                        {formatTime(t.receivedAt)}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 text-xs line-clamp-1",
                        t.read
                          ? "text-zinc-500 dark:text-zinc-500"
                          : "text-zinc-800 dark:text-zinc-200 font-medium",
                      )}
                    >
                      {t.body}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ----- Thread detail (right pane) -------------------------------- */}
      <section
        className={cn(
          "flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-950",
          "min-h-0 overflow-hidden",
          // Mobile: show when something is selected
          !selected && "hidden md:flex",
        )}
        data-testid="inbox-thread-detail"
      >
        {selected ? (
          <>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-900/40">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="md:hidden p-1 -ml-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                aria-label="Back to thread list"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                  <span
                    data-testid="inbox-detail-from"
                    className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate"
                  >
                    {selected.fromPhone}
                  </span>
                </div>
                <p
                  data-testid="inbox-detail-received"
                  className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5"
                >
                  {formatFull(selected.receivedAt)}
                </p>
              </div>
              {selected.read ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <Check className="h-3 w-3" /> read
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" /> unread
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="max-w-2xl space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">
                  Inbound message
                </div>
                <p
                  data-testid="inbox-detail-body"
                  className="text-sm leading-relaxed text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap"
                >
                  {selected.body}
                </p>
              </div>
            </div>

            {/* Reply box */}
            <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/40 dark:bg-zinc-900/40">
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 mb-2">
                  <Reply className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                    Reply
                  </span>
                </div>
                {senderIds.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Register a{" "}
                    <Link className="underline" href="/app/sender-ids">
                      sender ID
                    </Link>{" "}
                    to reply.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={replyFrom}
                      onChange={(e) => setReplyFrom(e.target.value)}
                      data-testid="inbox-reply-from"
                      className="h-8 text-xs rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2"
                    >
                      {senderIds.map((s) => (
                        <option key={s.id} value={s.value}>
                          {s.value}
                          {s.isDefault ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={3}
                      placeholder="Type your reply…"
                      data-testid="inbox-reply-body"
                      className="w-full text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-zinc-500">
                        {replyBody.length} / 1600
                      </span>
                      <button
                        type="button"
                        onClick={handleSendReply}
                        disabled={replyPending || !replyBody.trim()}
                        data-testid="inbox-reply-send"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-700 text-white transition disabled:opacity-50"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {replyPending ? "Sending…" : "Send reply"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <X className="h-8 w-8 text-zinc-300 dark:text-zinc-700 mx-auto mb-2" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Select a conversation to read and reply
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}