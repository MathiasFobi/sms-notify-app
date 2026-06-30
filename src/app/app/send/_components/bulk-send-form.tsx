"use client";

/**
 * "Bulk send an SMS" client form (second panel on `/app/send`).
 *
 * Provides two ways to add recipients:
 *
 *   1. **In-app spreadsheet** (default tab) — a paste-target table
 *      (`<BulkRecipientSheet>`). User can paste from Excel/Sheets,
 *      edit cells, add/remove rows. Best for small/medium lists.
 *   2. **Upload CSV** (secondary tab) — file input, parsed as CSV.
 *      Best for >500 rows or repeat uploads.
 *
 * Both paths serialize to the same `csv: string` payload the server
 * action expects.
 *
 * Server actions live in `@/lib/actions/bulk-send`; this component
 * owns tab state, sheet state, file-read state, and submit pending
 * state.
 *
 * On success: shows a summary banner with `sent`, `failed`, `skipped`.
 * On error: shows the server error message in a red banner.
 */

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { sendBulkSmsAction, type SendBulkSmsResult } from "@/lib/actions/bulk-send";
import {
  BulkRecipientSheet,
  type BulkSheetRow,
} from "@/components/bulk-recipient-sheet";
import { Download, Upload, TableProperties } from "lucide-react";
import { BULK_TEMPLATES, downloadCsv } from "@/lib/csv";

export interface BulkSendSmsFormProps {
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  defaultFromNumber: string | null;
  className?: string;
}

const MAX_BODY_CHARS = 1600;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

type InputMode = "sheet" | "upload";

export function BulkSendSmsForm({
  senderIds,
  defaultFromNumber,
  className,
}: BulkSendSmsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SendBulkSmsResult | null>(null);
  const [body, setBody] = useState<string>("");
  const [filename, setFilename] = useState<string | null>(null);
  const [mode, setMode] = useState<InputMode>("sheet");
  const [rows, setRows] = useState<BulkSheetRow[]>(
    Array.from({ length: 5 }, () => ({
      id: Math.random().toString(36).slice(2, 10),
      phone: "",
      name: "",
    }))
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const bodyId = useId();
  const fromId = useId();
  const fileId = useId();

  const overLimit = body.length > MAX_BODY_CHARS;

  const initialFromValue =
    defaultFromNumber ??
    (senderIds.find((s) => s.isDefault)?.value ?? senderIds[0]?.value ?? "");

  function sheetToCsv(sheetRows: BulkSheetRow[]): string {
    const valid = sheetRows
      .filter((r) => r.phone.trim().length > 0)
      .map((r) => {
        const phone = r.phone.replace(/"/g, '""');
        const name = (r.name ?? "").replace(/"/g, '""');
        return name ? `"${phone}","${name}"` : `"${phone}"`;
      });
    return ["phone,name", ...valid].join("\n");
  }

  function handleSubmit(formData: FormData) {
    const messageBody = String(formData.get("body") ?? "");
    const fromNumber = String(formData.get("fromNumber") ?? "").trim();

    if (messageBody.length === 0) {
      setError("Message body is required.");
      return;
    }
    if (messageBody.length > MAX_BODY_CHARS) {
      setError(
        `Message body is ${messageBody.length} characters; maximum is ${MAX_BODY_CHARS}.`,
      );
      return;
    }

    let csv = "";

    if (mode === "sheet") {
      const validRows = rows.filter((r) => r.phone.trim().length > 0);
      if (validRows.length === 0) {
        setError("Add at least one phone number in the table below.");
        return;
      }
      csv = sheetToCsv(validRows);
    } else {
      const file = fileInputRef.current?.files?.[0];
      if (!file) {
        setError("Please choose a CSV file to upload.");
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        setError(
          `CSV file is too large (${file.size} bytes); maximum is ${MAX_FILE_BYTES} bytes.`,
        );
        return;
      }
      // Read file synchronously via FileReader; onload fires async, we
      // wrap in a Promise and submit.
      setError(null);
      setSuccess(null);
      const reader = new FileReader();
      reader.onerror = () => setError("Failed to read the CSV file.");
      reader.onload = () => {
        const fileText = String(reader.result ?? "");
        if (fileText.length === 0) {
          setError("CSV file is empty.");
          return;
        }
        submitBulk(fileText, messageBody, fromNumber);
      };
      reader.readAsText(file);
      return;
    }

    setError(null);
    setSuccess(null);
    submitBulk(csv, messageBody, fromNumber);
  }

  function submitBulk(csv: string, messageBody: string, fromNumber: string) {
    startTransition(async () => {
      try {
        const result = await sendBulkSmsAction({
          csv,
          body: messageBody,
          fromNumber: fromNumber.length > 0 ? fromNumber : undefined,
        });
        setSuccess(result);
        setBody("");
        const form = document.getElementById("bulk-send-sms-form") as
          | HTMLFormElement
          | null;
        form?.reset();
        setFilename(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        if (mode === "sheet") {
          setRows(
            Array.from({ length: 5 }, () => ({
              id: Math.random().toString(36).slice(2, 10),
              phone: "",
              name: "",
            })),
          );
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to send bulk SMS",
        );
      }
    });
  }

  return (
    <form
      id="bulk-send-sms-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-3xl flex-col gap-4", className)}
    >
      {error ? (
        <div
          role="alert"
          data-testid="bulk-send-error"
          className={cn(
            "rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700",
            "dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
          )}
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          role="status"
          data-testid="bulk-send-success"
          data-message-id={success.messageId}
          data-sent={success.sent}
          data-failed={success.failed}
          data-skipped={success.skipped}
          className={cn(
            "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
            "dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          <p className="font-medium">Bulk send complete.</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            <li>
              <span data-testid="bulk-send-sent">{success.sent}</span> sent
            </li>
            {success.failed > 0 ? (
              <li>
                <span data-testid="bulk-send-failed">{success.failed}</span>{" "}
                failed at the provider
              </li>
            ) : null}
            {success.skipped > 0 ? (
              <li>
                <span data-testid="bulk-send-skipped">{success.skipped}</span>{" "}
                skipped ({success.invalid} invalid, {success.optedOut}{" "}
                opted-out)
              </li>
            ) : null}
            <li>messageId: {success.messageId}</li>
          </ul>
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

      {/* Recipients: tabbed sheet vs upload */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Recipients
          </label>
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
              data-testid="bulk-mode-sheet"
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
              data-testid="bulk-mode-upload"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
          </div>
        </div>

        {/* Templates row — separate so the header doesn't crowd */}
        <div>
          <button
            type="button"
            onClick={() => downloadCsv("bulk-template-standard.csv", BULK_TEMPLATES.standard())}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded border border-dashed border-zinc-300 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/30 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            data-testid="bulk-template-download"
          >
            <Download className="h-3 w-3" />
            Standard template
          </button>
        </div>

        {mode === "sheet" ? (
          <BulkRecipientSheet
            value={rows}
            onChange={setRows}
            data-testid="bulk-sheet"
          />
        ) : (
          <div className="flex flex-col gap-1">
            <label
              htmlFor={fileId}
              className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
            >
              CSV file (one column: phone, optional: name)
            </label>
            <input
              ref={fileInputRef}
              id={fileId}
              name="csv"
              type="file"
              accept=".csv,text/csv"
              disabled={isPending}
              data-testid="bulk-csv-input"
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

      <div className="flex flex-col gap-1">
        <label
          htmlFor={bodyId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
        >
          Message
        </label>
        <textarea
          id={bodyId}
          name="body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isPending}
          placeholder="Type your SMS message…"
          data-testid="bulk-body"
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

      <Button
        type="submit"
        disabled={isPending}
        data-testid="bulk-send-submit"
        className="self-start"
      >
        {isPending
          ? "Sending…"
          : mode === "sheet"
            ? `Send to ${rows.filter((r) => r.phone.trim().length > 0).length || 0} number${rows.filter((r) => r.phone.trim().length > 0).length === 1 ? "" : "s"}`
            : "Send bulk SMS"}
      </Button>
    </form>
  );
}