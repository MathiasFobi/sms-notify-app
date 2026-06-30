"use client";

/**
 * "Bulk send an SMS" client form (second panel on `/app/send`).
 *
 * Server actions live in `@/lib/actions/bulk-send`; this component is
 * `"use client"` because it owns:
 *   - the active-tab toggle (single vs. bulk)
 *   - the file-input → CSV reader pipeline (no upload server-side —
 *     we read the file in the browser and pass the text straight to
 *     the server action)
 *   - the submit-button pending state
 *   - inline success / error banners
 *
 * Fields:
 *   - `fromNumber` <select> — populated from the server with the user's
 *     sender IDs. Same source as the single-send form.
 *   - `csv` <input type="file"> — accepts a `.csv` file. The first
 *     column is treated as the phone number; a header row with the
 *     literal `phone` in cell 0 is detected and skipped. Other columns
 *     are ignored.
 *   - `body` <textarea> — the message body (one body per blast).
 *
 * On success: shows a summary banner with `sent`, `failed`, and
 * `skipped` counts, plus a preview of the inserted `messageId`.
 *
 * On error: shows the server error message in a red banner; the file
 * selection + body are preserved so the user can correct and retry.
 *
 * No new dependency — the tab toggle is just a `useState` boolean
 * (per the US-010 implementation note). We do NOT pull in a tab
 * library.
 */

import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { sendBulkSmsAction, type SendBulkSmsResult } from "@/lib/actions/bulk-send";

export interface BulkSendSmsFormProps {
  /** Approved + pending sender IDs for the current user. */
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  /** The current `users.twilio_from_number`, if set. */
  defaultFromNumber: string | null;
  className?: string;
}

const MAX_BODY_CHARS = 1600;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const bodyId = useId();
  const fromId = useId();
  const fileId = useId();

  const overLimit = body.length > MAX_BODY_CHARS;

  const initialFromValue =
    defaultFromNumber ??
    (senderIds.find((s) => s.isDefault)?.value ?? senderIds[0]?.value ?? "");

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

    setError(null);
    setSuccess(null);

    // Read the CSV as text and dispatch the server action.
    const reader = new FileReader();
    reader.onerror = () => {
      setError("Failed to read the CSV file.");
    };
    reader.onload = () => {
      const csv = String(reader.result ?? "");
      if (csv.length === 0) {
        setError("CSV file is empty.");
        return;
      }

      startTransition(async () => {
        try {
          const result = await sendBulkSmsAction({
            csv,
            body: messageBody,
            fromNumber: fromNumber.length > 0 ? fromNumber : undefined,
          });
          setSuccess(result);
          setBody("");
          // Clear the file input + body via the form reset.
          const form = document.getElementById("bulk-send-sms-form") as
            | HTMLFormElement
            | null;
          form?.reset();
          setFilename(null);
          if (fileInputRef.current) {
            fileInputRef.current.value = "";
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to send bulk SMS",
          );
        }
      });
    };
    reader.readAsText(file);
  }

  return (
    <form
      id="bulk-send-sms-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-xl flex-col gap-4", className)}
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
              (provider succeeded)
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

      <div className="flex flex-col gap-1">
        <label
          htmlFor={fileId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
        >
          CSV file (one column: phone)
        </label>
        <input
          ref={fileInputRef}
          id={fileId}
          name="csv"
          type="file"
          accept=".csv,text/csv"
          disabled={isPending}
          required
          data-testid="bulk-csv-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setFilename(f ? f.name : null);
          }}
          className={cn(
            "block w-full text-sm text-zinc-700",
            "file:mr-3 file:rounded-md file:border file:border-zinc-200",
            "file:bg-white file:px-3 file:py-1 file:text-sm file:text-zinc-900",
            "hover:file:bg-zinc-50",
            "dark:text-zinc-200 dark:file:border-zinc-700 dark:file:bg-zinc-900",
            "dark:file:text-zinc-100 dark:hover:file:bg-zinc-800",
          )}
        />
        {filename ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Selected: <span className="font-mono">{filename}</span>
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            First column must be the phone number. A header row with the
            literal <span className="font-mono">phone</span> in cell 0 is
            auto-detected and skipped.
          </p>
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
          rows={5}
          required
          maxLength={5000}
          disabled={isPending}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Type your message…"
          className={cn(
            "flex w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm",
            "placeholder:text-zinc-400 resize-y",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500",
            "dark:focus:ring-zinc-300",
            overLimit && "border-rose-400 focus:ring-rose-500",
          )}
        />
        <div
          className={cn(
            "flex justify-end text-xs",
            overLimit
              ? "text-rose-600 dark:text-rose-400"
              : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          <span data-testid="bulk-char-counter">
            {body.length} / {MAX_BODY_CHARS}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          disabled={isPending || overLimit || senderIds.length === 0}
        >
          {isPending ? "Sending…" : "Send bulk SMS"}
        </Button>
      </div>
    </form>
  );
}