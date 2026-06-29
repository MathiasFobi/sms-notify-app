"use client";

/**
 * Client component for uploading a CSV of contacts on /app/contacts.
 *
 * The native file input reads the file as text and posts the contents
 * to `importContactsAction`. After the call we surface a short
 * summary (inserted / skipped / errors) and reset the input so the
 * user can immediately upload another file.
 *
 * We use a `<form action={...}>` so the file is submitted through
 * the browser's normal form-pipe; the form handler just reads the
 * file via the FileReader API and forwards the text to the action.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { importContactsAction } from "@/lib/actions/contacts";

export interface ImportContactsFormProps {
  className?: string;
}

export interface ImportSummary {
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export function ImportContactsForm({ className }: ImportContactsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function handleFile(file: File): void {
    setError(null);
    setSummary(null);
    file
      .text()
      .then((text) => {
        startTransition(async () => {
          try {
            const result = await importContactsAction({ csv: text });
            setSummary(result);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Failed to import CSV",
            );
          }
        });
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error ? err.message : "Failed to read CSV file",
        );
      });
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="inline-flex w-fit items-center gap-2">
        <span
          className={cn(
            "inline-flex h-9 cursor-pointer items-center justify-center rounded-md px-4 text-sm font-medium",
            "bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50",
            "dark:bg-zinc-900 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800",
            isPending ? "pointer-events-none opacity-50" : "",
          )}
        >
          {isPending ? "Uploading…" : "Upload CSV"}
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleChange}
          disabled={isPending}
          aria-label="Upload contacts CSV"
          className="sr-only"
        />
      </label>
      {error !== null ? (
        <p
          role="alert"
          className="text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          {error}
        </p>
      ) : null}
      {summary !== null ? (
        <div
          role="status"
          className="text-xs text-zinc-600 dark:text-zinc-400"
        >
          <p>
            Imported {summary.inserted} contact{summary.inserted === 1 ? "" : "s"}
            {summary.skipped > 0
              ? `, skipped ${summary.skipped}`
              : ""}
            {summary.errors.length > 0
              ? `, ${summary.errors.length} error${summary.errors.length === 1 ? "" : "s"}`
              : ""}
            .
          </p>
          {summary.errors.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {summary.errors.slice(0, 5).map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  Row {e.row}: {e.message}
                </li>
              ))}
              {summary.errors.length > 5 ? (
                <li>…and {summary.errors.length - 5} more</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}