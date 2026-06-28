/**
 * SMS provider abstraction.
 *
 * Every SMS send path in the app MUST go through an `SmsProvider` so that:
 *  - We never call Twilio (or any real vendor) during local development.
 *  - Tests can swap in an in-memory implementation with no network/DB deps.
 *  - The same call site can target different vendors in production by
 *    changing the `SMS_PROVIDER` env var.
 *
 * Providers are expected to be cheap to construct but stateful enough that
 * `send()` and `fetch()` can be correlated by `providerMessageId` — i.e.
 * `fetch(id)` after a successful `send()` should return a status that
 * reflects the outcome of that send (mock or real).
 *
 * Spec (US-004):
 *  - `SmsMessage`   — the input shape every provider must accept.
 *  - `SmsSendResult` — the result of a send attempt (success or failure).
 *  - `SmsProvider`  — the swappable interface with `send` and `fetch`.
 *  - `SmsStatus`    — what `fetch` returns (the current lifecycle state).
 */

/** A phone number in E.164 format, e.g. `+15551234567`. */
export type SmsTo = string;

/** Lifecycle status reported by `SmsProvider.fetch()`. */
export type SmsStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered";

/**
 * Input to `SmsProvider.send()`.
 *
 * `from` is optional — providers may substitute a configured default when
 * omitted. `callbackUrl` lets the caller register a status webhook for
 * delivery receipts (the mock provider ignores it; real providers use it).
 */
export interface SmsMessage {
  to: SmsTo;
  body: string;
  from?: string;
  callbackUrl?: string;
}

/**
 * Result of `SmsProvider.send()`.
 *
 * On success `ok === true` and `providerMessageId` is populated. On
 * failure `ok === false`, `error` is human-readable, and the optional
 * `providerMessageId` may still be set if the vendor accepted the message
 * but reported a downstream error.
 */
export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  priceUsd: number;
  segments: number;
  error?: string;
}

/** A snapshot of a sent message's current status, as returned by `fetch()`. */
export interface SmsFetchResult {
  providerMessageId: string;
  status: SmsStatus;
  priceUsd: number;
  segments: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * The swappable SMS provider interface.
 *
 * Implementations:
 *  - `MockSmsProvider` — in-memory, no I/O. See `./mock-provider.ts`.
 *  - `TwilioSmsProvider` — real vendor (NOT YET IMPLEMENTED, see `./index.ts`).
 */
export interface SmsProvider {
  /** Send a single SMS. Never throws on vendor errors; returns `{ ok: false, error }`. */
  send(message: SmsMessage): Promise<SmsSendResult>;

  /**
   * Look up the current status of a previously-sent message by its
   * `providerMessageId`. Returns `null` if the provider has no record of
   * that id (unknown, expired, or never existed).
   */
  fetch(providerMessageId: string): Promise<SmsFetchResult | null>;
}
