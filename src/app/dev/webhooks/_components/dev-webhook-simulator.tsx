"use client";

/**
 * `/dev/webhooks` client simulator (US-014).
 *
 * Three tiny forms that POST `application/x-www-form-urlencoded`
 * payloads (the same shape Twilio sends) to the corresponding
 * Twilio webhook route handlers:
 *
 *   1. Status callback — `/api/webhooks/twilio/status`
 *   2. Inbound message — `/api/webhooks/twilio/inbound`
 *   3. STOP keyword    — same endpoint as inbound, but with a
 *                        dropdown of valid opt-out keywords
 *                        (re-using `OPT_OUT_KEYWORDS` from
 *                        `src/lib/webhooks/twilio-inbound.ts`).
 *
 * Each form surfaces the HTTP status code + JSON body returned
 * by the route. This is a dev-only aid — the route handlers are
 * idempotent on `twilio_message_sid`, so spamming "Send" multiple
 * times with the same id is safe (the duplicates return
 * `{ ok: true, result: 'duplicate' }` instead of writing new
 * rows).
 *
 * The page itself is a server component (see `page.tsx`); the
 * `forms="use client" boundary lives in THIS file because each
 * form needs `useTransition` for the submit button's pending
 * state and React state for the response banner. We re-export
 * them as a single `<DevWebhookSimulator>` so `page.tsx` only
 * needs to import one symbol.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

// ============================================================================
// Reused keyword list (single source of truth lives in twilio-inbound.ts)
// ============================================================================

/**
 * The opt-out keywords we recognize. Mirror of `OPT_OUT_KEYWORDS`
 * in `src/lib/webhooks/twilio-inbound.ts`. Duplicated here on
 * purpose — the dev simulator should not depend on the webhook
 * module's runtime values to keep the form's options stable
 * across helper tweaks. Adding/removing a keyword here means
 * updating the helper too.
 */
const OPT_OUT_KEYWORD_OPTIONS = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
] as const;

// ============================================================================
// Shared response banner
// ============================================================================

interface ResponseBannerState {
  status: number;
  body: string;
}

function ResponseBanner({ response }: { response: ResponseBannerState | null }) {
  if (!response) return null;
  const ok = response.status >= 200 && response.status < 300;
  return (
    <div
      role="status"
      data-testid={`webhook-response-${response.status}`}
      data-status={response.status}
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300",
      )}
    >
      <div className="font-medium">
        {response.status} {ok ? "OK" : "Error"}
      </div>
      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px]">
        {response.body}
      </pre>
    </div>
  );
}

// ============================================================================
// Generic submit helper — POST form-encoded fields to `path`
// ============================================================================

interface PostFieldsResult {
  status: number;
  body: string;
}

async function postForm(
  path: string,
  fields: Record<string, string>,
): Promise<PostFieldsResult> {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

// ============================================================================
// Form 1: Status callback
// ============================================================================

const STATUS_OPTIONS = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "failed",
  "undelivered",
];

function StatusCallbackForm() {
  const [isPending, startTransition] = useTransition();
  const [response, setResponse] = useState<ResponseBannerState | null>(null);

  function handleSubmit(formData: FormData) {
    const messageSid = String(formData.get("messageSid") ?? "").trim();
    const messageStatus = String(formData.get("messageStatus") ?? "").trim();
    const errorCode = String(formData.get("errorCode") ?? "").trim();

    if (messageSid.length === 0) {
      setResponse({ status: 400, body: "MessageSid is required" });
      return;
    }
    if (messageStatus.length === 0) {
      setResponse({ status: 400, body: "MessageStatus is required" });
      return;
    }

    const fields: Record<string, string> = { MessageSid: messageSid, MessageStatus: messageStatus };
    // Only include ErrorCode if the user typed one — empty strings
    // would short-circuit to "ErrorCode is required" in some
    // implementations; the real route handler accepts an empty
    // string, but omitting it keeps the test signal clean.
    if (errorCode.length > 0) fields.ErrorCode = errorCode;

    setResponse(null);
    startTransition(async () => {
      try {
        const result = await postForm("/api/webhooks/twilio/status", fields);
        setResponse(result);
      } catch (err) {
        setResponse({
          status: 0,
          body: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return (
    <form
      id="dev-webhook-status-form"
      action={handleSubmit}
      className="flex flex-col gap-3"
    >
      <FormHeader
        title="Status callback"
        subtitle="POST /api/webhooks/twilio/status"
      />
      <Field label="MessageSid">
        <Input
          name="messageSid"
          placeholder="SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={isPending}
          required
          data-testid="status-message-sid"
        />
      </Field>
      <Field label="MessageStatus">
        <select
          name="messageStatus"
          defaultValue="delivered"
          disabled={isPending}
          data-testid="status-message-status"
          className={cn(
            "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
          )}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ErrorCode (optional)">
        <Input
          name="errorCode"
          placeholder="30007"
          disabled={isPending}
          data-testid="status-error-code"
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} data-testid="status-submit">
          {isPending ? "Sending…" : "Send status callback"}
        </Button>
      </div>
      <ResponseBanner response={response} />
    </form>
  );
}

// ============================================================================
// Form 2: Inbound message
// ============================================================================

function InboundMessageForm() {
  const [isPending, startTransition] = useTransition();
  const [response, setResponse] = useState<ResponseBannerState | null>(null);

  function handleSubmit(formData: FormData) {
    const from = String(formData.get("from") ?? "").trim();
    const to = String(formData.get("to") ?? "").trim();
    const body = String(formData.get("body") ?? "");
    const messageSid = String(formData.get("messageSid") ?? "").trim();

    if (from.length === 0 || to.length === 0 || messageSid.length === 0) {
      setResponse({
        status: 400,
        body: "From, To, and MessageSid are all required.",
      });
      return;
    }

    setResponse(null);
    startTransition(async () => {
      try {
        const result = await postForm("/api/webhooks/twilio/inbound", {
          From: from,
          To: to,
          Body: body,
          MessageSid: messageSid,
        });
        setResponse(result);
      } catch (err) {
        setResponse({
          status: 0,
          body: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return (
    <form
      id="dev-webhook-inbound-form"
      action={handleSubmit}
      className="flex flex-col gap-3"
    >
      <FormHeader
        title="Inbound message"
        subtitle="POST /api/webhooks/twilio/inbound"
      />
      <Field label="From">
        <Input
          name="from"
          placeholder="+15551234567"
          disabled={isPending}
          required
          data-testid="inbound-from"
        />
      </Field>
      <Field label="To">
        <Input
          name="to"
          placeholder="+15550000000"
          disabled={isPending}
          required
          data-testid="inbound-to"
        />
      </Field>
      <Field label="MessageSid">
        <Input
          name="messageSid"
          placeholder="SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={isPending}
          required
          data-testid="inbound-message-sid"
        />
      </Field>
      <Field label="Body">
        <textarea
          name="body"
          rows={3}
          placeholder="Hi! Thanks for the reminder."
          disabled={isPending}
          data-testid="inbound-body"
          className={cn(
            "flex w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm",
            "placeholder:text-zinc-400 resize-y",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-500",
            "dark:focus:ring-zinc-300",
          )}
        />
      </Field>
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending}
          data-testid="inbound-submit"
        >
          {isPending ? "Sending…" : "Send inbound message"}
        </Button>
      </div>
      <ResponseBanner response={response} />
    </form>
  );
}

// ============================================================================
// Form 3: STOP keyword
// ============================================================================

function StopKeywordForm() {
  const [isPending, startTransition] = useTransition();
  const [response, setResponse] = useState<ResponseBannerState | null>(null);

  function handleSubmit(formData: FormData) {
    const from = String(formData.get("from") ?? "").trim();
    const to = String(formData.get("to") ?? "").trim();
    const messageSid = String(formData.get("messageSid") ?? "").trim();
    const body = String(formData.get("body") ?? "STOP");

    if (from.length === 0 || to.length === 0 || messageSid.length === 0) {
      setResponse({
        status: 400,
        body: "From, To, and MessageSid are all required.",
      });
      return;
    }

    setResponse(null);
    startTransition(async () => {
      try {
        const result = await postForm("/api/webhooks/twilio/inbound", {
          From: from,
          To: to,
          Body: body,
          MessageSid: messageSid,
        });
        setResponse(result);
      } catch (err) {
        setResponse({
          status: 0,
          body: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return (
    <form
      id="dev-webhook-stop-form"
      action={handleSubmit}
      className="flex flex-col gap-3"
    >
      <FormHeader
        title="STOP keyword"
        subtitle="POST /api/webhooks/twilio/inbound (Body = opt-out keyword)"
      />
      <Field label="From">
        <Input
          name="from"
          placeholder="+15551234567"
          disabled={isPending}
          required
          data-testid="stop-from"
        />
      </Field>
      <Field label="To">
        <Input
          name="to"
          placeholder="+15550000000"
          disabled={isPending}
          required
          data-testid="stop-to"
        />
      </Field>
      <Field label="MessageSid">
        <Input
          name="messageSid"
          placeholder="SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          disabled={isPending}
          required
          data-testid="stop-message-sid"
        />
      </Field>
      <Field label="Body (opt-out keyword)">
        <select
          name="body"
          defaultValue="STOP"
          disabled={isPending}
          data-testid="stop-body"
          className={cn(
            "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-300",
          )}
        >
          {OPT_OUT_KEYWORD_OPTIONS.map((kw) => (
            <option key={kw} value={kw}>
              {kw}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending} data-testid="stop-submit">
          {isPending ? "Sending…" : "Send STOP keyword"}
        </Button>
      </div>
      <ResponseBanner response={response} />
    </form>
  );
}

// ============================================================================
// Shared layout primitives
// ============================================================================

function FormHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

// ============================================================================
// Public bundle
// ============================================================================

/**
 * The simulator the page mounts. Renders all three forms inside a
 * stacked column. Keeps the page file small by folding the form
 * layout (panel chrome, spacing, etc.) into one component.
 */
export function DevWebhookSimulator() {
  return (
    <div
      className="flex flex-col gap-6"
      data-testid="dev-webhook-simulator"
    >
      <SimulatorPanel>
        <StatusCallbackForm />
      </SimulatorPanel>
      <SimulatorPanel>
        <InboundMessageForm />
      </SimulatorPanel>
      <SimulatorPanel>
        <StopKeywordForm />
      </SimulatorPanel>
    </div>
  );
}

function SimulatorPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white p-5",
        "dark:border-zinc-800 dark:bg-zinc-950",
      )}
    >
      {children}
    </div>
  );
}
