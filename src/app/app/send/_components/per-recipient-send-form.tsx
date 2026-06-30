"use client";

/**
 * "Per-recipient bulk send" — second tab of `/app/send`.
 *
 * Like the standard bulk form, but each row can carry its own message
 * that overrides a global default. Rows without a per-row message
 * fall back to the default. All sends are dispatched in parallel via
 * the existing `sendSmsAction` (one per row) and the results are
 * aggregated into a single summary banner with per-row status.
 *
 * Why not use `sendBulkSmsAction`? Because that action sends ONE body
 * to many recipients. Per-recipient bodies need a fan-out of single
 * sends, which the existing single-send server action already does.
 *
 * Use cases:
 *   - Personalized reminders: "Hi {name}, your appointment is at {time}"
 *   - Order updates with per-customer content
 *   - Survey follow-ups with custom copy
 */

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { sendSmsAction } from "@/lib/actions/send";
import {
  BulkRecipientSheet,
  type BulkSheetRow,
} from "@/components/bulk-recipient-sheet";
import { Download, TableProperties, Upload } from "lucide-react";
import { BULK_TEMPLATES, downloadCsv } from "@/lib/csv";

export interface PerRecipientSendSmsFormProps {
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  defaultFromNumber: string | null;
  className?: string;
}

const MAX_BODY_CHARS = 1600;
const DEFAULT_ROW_COUNT = 5;
const MAX_ROWS = 500;

type InputMode = "sheet" | "upload";

type RowResult = {
  rowIndex: number;
  phone: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
};

export function PerRecipientSendSmsForm({
  senderIds,
  defaultFromNumber,
  className,
}: PerRecipientSendSmsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [body, setBody] = useState<string>("");
  const [filename, setFilename] = useState<string | null>(null);
  const [mode, setMode] = useState<InputMode>("sheet");
  const [rows, setRows] = useState<BulkSheetRow[]>(
    Array.from({ length: DEFAULT_ROW_COUNT }, () => ({
      id: Math.random().toString(36).slice(2, 10),
      phone: "",
      name: "",
      message: "",
    }))
  );
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const bodyId = useId();
  const fromId = useId();
  const fileId = useId();

  const overLimit = body.length > MAX_BODY_CHARS;

  const initialFromValue =
    defaultFromNumber ??
    (senderIds.find((s) => s.isDefault)?.value ?? senderIds[0]?.value ?? "");

  function handleSubmit(formData: FormData) {
    const defaultBody = String(formData.get("body") ?? "").trim();
    const fromNumber = String(formData.get("fromNumber") ?? "").trim();

    if (!defaultBody) {
      setError("Default message is required. Rows can override it, but the default is the fallback.");
      return;
    }
    if (defaultBody.length > MAX_BODY_CHARS) {
      setError(
        `Default message is ${defaultBody.length} characters; maximum is ${MAX_BODY_CHARS}.`,
      );
      return;
    }

    let pending: BulkSheetRow[] = [];

    if (mode === "sheet") {
      pending = rows
        .map((r) => ({ ...r, phone: r.phone.trim() }))
        .filter((r) => r.phone.length > 0);
    } else {
      const file = fileInputRef.current?.files?.[0];
      if (!file) {
        setError("Please choose a CSV file to upload.");
        return;
      }
      setError(null);
      setResults(null);
      const reader = new FileReader();
      reader.onerror = () => setError("Failed to read the CSV file.");
      reader.onload = () => {
        const text = String(reader.result ?? "");
        if (text.length === 0) {
          setError("CSV file is empty.");
          return;
        }
        pending = parsePerRecipientCsv(text).filter((r) => r.phone.length > 0);
        if (pending.length === 0) {
          setError("No valid rows in the CSV.");
          return;
        }
        runFanout(pending, defaultBody, fromNumber);
      };
      reader.readAsText(file);
      return;
    }

    if (pending.length === 0) {
      setError("Add at least one phone number in the table below.");
      return;
    }

    setError(null);
    setResults(null);
    runFanout(pending, defaultBody, fromNumber);
  }

  function runFanout(
    pending: BulkSheetRow[],
    defaultBody: string,
    fromNumber: string
  ) {
    const total = pending.length;
    setProgress({ done: 0, total });

    startTransition(async () => {
      const acc: RowResult[] = [];
      // Fan out with bounded concurrency (4 in flight at once) so a 500-row
      // send doesn't slam the provider.
      const concurrency = 4;
      let cursor = 0;
      async function worker() {
        while (cursor < pending.length) {
          const idx = cursor++;
          const row = pending[idx]!;
          const messageBody =
            (row.message && row.message.trim()) || defaultBody;
          try {
            const r = await sendSmsAction({
              to: row.phone,
              body: messageBody,
              fromNumber: fromNumber.length > 0 ? fromNumber : undefined,
            });
            acc.push({
              rowIndex: idx + 1,
              phone: row.phone,
              status: "sent",
              messageId: r.providerMessageId,
            });
          } catch (err) {
            acc.push({
              rowIndex: idx + 1,
              phone: row.phone,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
            });
          }
          setProgress({ done: acc.length, total });
        }
      }
      await Promise.all(
        Array.from({ length: concurrency }, () => worker())
      );
      setResults(acc);
      setProgress(null);
      // Reset form state on success.
      setBody("");
      const form = document.getElementById("per-recipient-send-form") as
        | HTMLFormElement
        | null;
      form?.reset();
      setFilename(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (mode === "sheet") {
        setRows(
          Array.from({ length: DEFAULT_ROW_COUNT }, () => ({
            id: Math.random().toString(36).slice(2, 10),
            phone: "",
            name: "",
            message: "",
          })),
        );
      }
    });
  }

  return (
    <form
      id="per-recipient-send-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-4xl flex-col gap-4", className)}
    >
      {error ? (
        <div
          role="alert"
          data-testid="per-recipient-error"
          className={cn(
            "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700",
            "dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
          )}
        >
          {error}
        </div>
      ) : null}
      {progress ? (
        <div
          role="status"
          data-testid="per-recipient-progress"
          className={cn(
            "rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-700",
            "dark:border-cyan-900/50 dark:bg-cyan-950/40 dark:text-cyan-300",
          )}
        >
          Sending… {progress.done} / {progress.total}
        </div>
      ) : null}
      {results ? (
        <div
          role="status"
          data-testid="per-recipient-results"
          data-sent={results.filter((r) => r.status === "sent").length}
          data-failed={results.filter((r) => r.status === "failed").length}
          className={cn(
            "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
            "dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          <p className="font-medium">Per-recipient send complete.</p>
          <p className="text-xs mt-1">
            <span data-testid="per-recipient-sent">
              {results.filter((r) => r.status === "sent").length}
            </span>{" "}
            sent ·{" "}
            <span data-testid="per-recipient-failed">
              {results.filter((r) => r.status === "failed").length}
            </span>{" "}
            failed
          </p>
          {results.some((r) => r.status === "failed") ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-emerald-800 dark:text-emerald-200">
                Show per-row status
              </summary>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                {results.map((r) => (
                  <li key={r.rowIndex} className="flex items-start gap-2">
                    <span className="w-8 text-right text-zinc-500">
                      {r.rowIndex}.
                    </span>
                    <span
                      className={
                        r.status === "sent"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-rose-700 dark:text-rose-300"
                      }
                    >
                      {r.status === "sent" ? "✓" : "✗"} {r.phone}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {r.status === "sent" ? r.messageId : r.error}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fromId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
        >
          From
        </label>
        {senderIds.length === 0 ? (
          <p
            className={cn(
              "rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-500",
              "dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400",
            )}
          >
            No sender IDs registered. Visit{" "}
            <a className="underline" href="/app/sender-ids">
              Sender IDs
            </a>{" "}
            to register one.
          </p>
        ) : (
          <select
            id={fromId}
            name="fromNumber"
            defaultValue={initialFromValue}
            disabled={isPending}
            className={cn(
              "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm",
              "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
            )}
          >
            {senderIds.map((s) => (
              <option key={s.id} value={s.value}>
                {s.value}
                {s.isDefault ? " (default)" : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Default message (fallback for rows with no per-row override) */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={bodyId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
        >
          Default message <span className="text-zinc-400 normal-case font-normal">(used when a row's message is empty)</span>
        </label>
        <textarea
          id={bodyId}
          name="body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isPending}
          placeholder="Hi {name}, … (rows with their own message field will override this)"
          data-testid="per-recipient-default-body"
          className={cn(
            "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
            overLimit && "border-rose-400 focus:ring-rose-400"
          )}
        />
        <p
          className={cn(
            "text-[11px] text-right",
            overLimit ? "text-rose-600" : "text-zinc-500"
          )}
        >
          {body.length} / {MAX_BODY_CHARS}
        </p>
      </div>

      {/* Recipients: tabbed sheet vs upload */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Recipients
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => downloadCsv("bulk-template-standard.csv", BULK_TEMPLATES.standard())}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              data-testid="per-recipient-template-standard"
            >
              <Download className="h-3.5 w-3.5" />
              Standard template
            </button>
            <button
              type="button"
              onClick={() => downloadCsv("bulk-template-per-recipient.csv", BULK_TEMPLATES.perRecipient())}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
              data-testid="per-recipient-template-per-recipient"
            >
              <Download className="h-3.5 w-3.5" />
              Per-recipient template
            </button>
            <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 p-0.5 bg-zinc-50 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setMode("sheet")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition",
                  mode === "sheet"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                )}
                data-testid="per-recipient-mode-sheet"
              >
                <TableProperties className="h-3.5 w-3.5" />
                Sheet
              </button>
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition",
                  mode === "upload"
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                )}
                data-testid="per-recipient-mode-upload"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload CSV
              </button>
            </div>
          </div>
        </div>

        {mode === "sheet" ? (
          <BulkRecipientSheet
            value={rows}
            onChange={setRows}
            showMessageColumn
            maxRows={MAX_ROWS}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={fileId}
              className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
            >
              CSV file: phone, name (optional), message (optional)
            </label>
            <input
              ref={fileInputRef}
              id={fileId}
              name="csv"
              type="file"
              accept=".csv,text/csv"
              disabled={isPending}
              data-testid="per-recipient-csv-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFilename(f ? f.name : null);
              }}
              className={cn(
                "block w-full text-sm text-zinc-900 dark:text-zinc-50",
                "file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border-0",
                "file:bg-zinc-100 file:text-zinc-700 file:font-medium",
                "hover:file:bg-zinc-200 dark:file:bg-zinc-800 dark:file:text-zinc-200",
                "disabled:opacity-50"
              )}
            />
            {filename ? (
              <p className="text-xs text-zinc-500 mt-1">
                Selected: <span className="font-mono">{filename}</span>
              </p>
            ) : null}
          </div>
        )}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        data-testid="per-recipient-submit"
        className="self-start"
      >
        {isPending
          ? "Sending…"
          : `Send to ${rows.filter((r) => r.phone.trim().length > 0).length || 0} number${rows.filter((r) => r.phone.trim().length > 0).length === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}

/**
 * Parse a CSV string into BulkSheetRow[]. Expects the first row to be
 * a header: phone,name,message (message is optional). Other header
 * shapes are tolerated as long as "phone" is the first column.
 */
function parsePerRecipientCsv(csv: string): BulkSheetRow[] {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n").filter(Boolean);
  if (lines.length === 0) return [];

  // Find header row — skip until a line with "phone" in column 1.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const first = (lines[i] ?? "").split(",")[0]?.trim() ?? "";
    if (/^phone$/i.test(first)) {
      headerIdx = i;
      break;
    }
  }

  const dataLines = lines.slice(headerIdx + 1);
  return dataLines
    .map((line) => {
      const cells = line.includes("\t")
        ? line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""))
        : line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      return {
        id: Math.random().toString(36).slice(2, 10),
        phone: cells[0] ?? "",
        name: cells[1] || undefined,
        message: cells[2] || undefined,
      };
    })
    .filter((r) => r.phone.length > 0);
}