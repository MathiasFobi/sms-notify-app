"use client";

/**
 * "Send an SMS" client form (`/app/send`).
 *
 * Server actions and pages live in their own server modules; this
 * component is `"use client"` because it owns the submit-button
 * pending state and surfaces server errors inline.
 *
 * Fields:
 *   - `fromNumber` <select> — populated from the server with the
 *     user's sender IDs (approved + pending). The current default
 *     (`users.twilio_from_number`) is selected on first render.
 *   - `to` <input> — phone number, free-form. Server normalizes via
 *     `normalizePhone`.
 *   - `body` <textarea> — the message body. Character counter shows
 *     `N / 1600`; turns red over 1600 chars.
 *
 * On success: shows the returned `providerMessageId` in a green
 * banner and resets the form fields.
 *
 * On error: shows the server error message in a red banner; the
 * form fields are preserved so the user can correct and retry.
 */

import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { sendSmsAction } from "@/lib/actions/send";

export interface SendSmsFormProps {
  /** Approved + pending sender IDs for the current user. */
  senderIds: Array<{ id: number; value: string; isDefault: boolean }>;
  /** The current `users.twilio_from_number`, if set. */
  defaultFromNumber: string | null;
  className?: string;
}

const MAX_BODY_CHARS = 1600;

export function SendSmsForm({
  senderIds,
  defaultFromNumber,
  className,
}: SendSmsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    providerMessageId: string;
    messageId: number;
  } | null>(null);
  const [body, setBody] = useState<string>("");

  const toId = useId();
  const bodyId = useId();
  const fromId = useId();

  const overLimit = body.length > MAX_BODY_CHARS;

  // Pick the initial from-value: explicit default first, then any
  // sender id marked as default, otherwise the first sender id.
  const initialFromValue =
    defaultFromNumber ??
    (senderIds.find((s) => s.isDefault)?.value ?? senderIds[0]?.value ?? "");

  function handleSubmit(formData: FormData) {
    const to = String(formData.get("to") ?? "").trim();
    const messageBody = String(formData.get("body") ?? "");
    const fromNumber = String(formData.get("fromNumber") ?? "").trim();

    if (to.length === 0) {
      setError("Recipient phone number is required.");
      return;
    }
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

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const result = await sendSmsAction({
          to,
          body: messageBody,
          fromNumber: fromNumber.length > 0 ? fromNumber : undefined,
        });
        setSuccess({
          providerMessageId: result.providerMessageId,
          messageId: result.messageId,
        });
        setBody("");
        // Clear the form fields imperatively after a successful send.
        const form = document.getElementById("send-sms-form") as
          | HTMLFormElement
          | null;
        form?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send SMS");
      }
    });
  }

  return (
    <form
      id="send-sms-form"
      action={handleSubmit}
      className={cn("flex w-full max-w-xl flex-col gap-4", className)}
    >
      {error ? (
        <div
          role="alert"
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
          data-testid="send-success"
          data-provider-message-id={success.providerMessageId}
          data-message-id={success.messageId}
          className={cn(
            "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700",
            "dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300",
          )}
        >
          <span className="font-medium">Sent!</span> providerMessageId:{" "}
          <span className="font-mono">{success.providerMessageId}</span>
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
          htmlFor={toId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400"
        >
          To (phone number)
        </label>
        <Input
          id={toId}
          name="to"
          type="tel"
          inputMode="tel"
          placeholder="+15551234567 or (555) 123-4567"
          aria-label="Recipient phone number"
          disabled={isPending}
          required
        />
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
          <span data-testid="char-counter">
            {body.length} / {MAX_BODY_CHARS}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          disabled={isPending || overLimit || senderIds.length === 0}
        >
          {isPending ? "Sending…" : "Send SMS"}
        </Button>
      </div>
    </form>
  );
}