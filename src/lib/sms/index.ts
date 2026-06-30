import { MockSmsProvider } from "./mock-provider";
import type { SmsProvider } from "./provider";

export type { SmsMessage, SmsSendResult, SmsProvider, SmsStatus, SmsFetchResult } from "./provider";
export { MockSmsProvider } from "./mock-provider";

/**
 * Singleton SMS provider.
 *
 * Default is `MockSmsProvider` so development, tests, and CI never touch
 * a real vendor. To enable the real Twilio provider (once it exists),
 * set `SMS_PROVIDER=twilio` in the environment.
 *
 * NOTE: This module intentionally reads `process.env.SMS_PROVIDER` directly
 * instead of going through `src/lib/env.ts` — we don't want the SMS layer
 * to depend on Twilio env vars, which are required by env.ts at boot but
 * are irrelevant when only the mock is in use.
 */
let cached: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (cached) return cached;

  const providerName = process.env.SMS_PROVIDER;

  if (providerName === "twilio") {
    // TODO: implement TwilioSmsProvider in ./twilio-provider.ts.
    // Throw for now so a misconfigured deployment fails loudly rather than
    // silently sending through the mock in production.
    throw new Error(
      "SMS_PROVIDER=twilio is set, but TwilioSmsProvider is not implemented yet. " +
        "Create src/lib/sms/twilio-provider.ts and wire it up here.",
    );
  }

  // Default — and currently the only — implementation.
  cached = new MockSmsProvider();
  return cached;
}

/**
 * Test helper: reset the cached singleton so tests get a fresh
 * `MockSmsProvider` with an empty in-memory store. Never call this from
 * production code.
 */
export function __resetSmsProviderForTests(): void {
  cached = null;
}
