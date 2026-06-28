import { randomUUID } from "node:crypto";
import type {
  SmsFetchResult,
  SmsMessage,
  SmsProvider,
  SmsSendResult,
  SmsStatus,
} from "./provider";

/**
 * In-memory mock SMS provider.
 *
 * - No network calls, no DB dependency — every send is recorded in a
 *   plain `Map<string, SmsFetchResult>` keyed by `providerMessageId`.
 * - `send()` always succeeds and always returns the same shape so
 *   downstream code (DB writes, billing, webhook plumbing) can be built
 *   and tested without touching a real vendor.
 * - `fetch()` looks the id up in the same map; unknown ids return `null`
 *   so callers can distinguish "never sent" from "failed".
 *
 * Pricing is a fixed $0.0079 / segment — close enough to US Twilio rates
 * for development. Real pricing belongs in the Twilio provider.
 *
 * Each fresh `new MockSmsProvider()` instance gets its own store, so unit
 * tests get isolation for free. The singleton used by the app is created
 * in `./index.ts` via `getSmsProvider()`.
 */
export class MockSmsProvider implements SmsProvider {
  /** Fixed per-segment price in USD (US Twilio, GSM-7, ~mid 2024). */
  static readonly PRICE_USD_PER_SEGMENT = 0.0079;

  /**
   * Default post-send status. The mock pretends every message was
   * accepted and is sitting in the carrier queue; if a test wants to
   * exercise the "delivered" or "failed" branches it should call
   * `#setStatus` directly.
   */
  static readonly DEFAULT_STATUS: SmsStatus = "sent";

  private readonly store = new Map<string, SmsFetchResult>();

  async send(message: SmsMessage): Promise<SmsSendResult> {
    // Validate the bare minimum. Real providers do much more; the mock
    // just refuses clearly-malformed input so callers can't accidentally
    // exercise the success path with garbage.
    if (!message || !message.to || typeof message.to !== "string") {
      return { ok: false, priceUsd: 0, segments: 0, error: "to is required" };
    }
    if (!message.body || typeof message.body !== "string") {
      return { ok: false, priceUsd: 0, segments: 0, error: "body is required" };
    }

    const providerMessageId = `mock_${randomUUID()}`;
    const segments = 1; // Mock always reports a single segment for now.
    const priceUsd = MockSmsProvider.PRICE_USD_PER_SEGMENT;

    this.store.set(providerMessageId, {
      providerMessageId,
      status: MockSmsProvider.DEFAULT_STATUS,
      priceUsd,
      segments,
    });

    return {
      ok: true,
      providerMessageId,
      priceUsd,
      segments,
    };
  }

  async fetch(providerMessageId: string): Promise<SmsFetchResult | null> {
    if (!providerMessageId) return null;
    return this.store.get(providerMessageId) ?? null;
  }

  /**
   * Test helper: force a previously-sent message into a specific status.
   * Not part of the `SmsProvider` contract — used by tests that want to
   * simulate delivery receipts without going through a webhook.
   */
  setStatus(providerMessageId: string, status: SmsStatus): boolean {
    const existing = this.store.get(providerMessageId);
    if (!existing) return false;
    this.store.set(providerMessageId, { ...existing, status });
    return true;
  }

  /** Test helper: number of messages currently held in the in-memory store. */
  size(): number {
    return this.store.size;
  }
}
