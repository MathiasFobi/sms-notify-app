<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:mock-providers-directive -->
# ⚠️ BUILD DIRECTIVE — MOCK PROVIDERS (effective for US-004 onward)

**We are building with mock data, not real third-party services.** Do NOT install or call `twilio`, `stripe`, or any other live SDK. Build all external integrations behind interfaces with mock implementations.

## Required provider interfaces

### `src/lib/sms/provider.ts`
```ts
export type SmsMessage = {
  to: string;          // E.164 phone number
  from?: string;        // sender id or null for shared pool
  body: string;
  metadata?: Record<string, string>;
};

export type SmsSendResult =
  | { ok: true; providerMessageId: string; priceUsd?: number; segments?: number }
  | { ok: false; error: string; retryable?: boolean };

export interface SmsProvider {
  send(msg: SmsMessage): Promise<SmsSendResult>;
  /** Fetch a single message by provider id (used by status callbacks / delivery reports) */
  fetch(providerMessageId: string): Promise<{ status: "queued" | "sent" | "delivered" | "failed"; errorCode?: string } | null>;
}
```

### `src/lib/sms/mock-provider.ts` (the active implementation in dev/test)
- `send()`: insert a row into `sms_messages` with `provider='mock'`, `provider_message_id=mock_<uuid>`, `status='queued'` then immediately flip to `sent` then `delivered` after a brief async tick (use `setTimeout` or fire-and-forget). Return `{ ok: true, providerMessageId, priceUsd: 0.0079, segments: 1 }`.
- `fetch()`: look up the row in `sms_messages` and return its status.

### `src/lib/sms/index.ts`
- Exports `getSmsProvider()` that returns the mock provider unless `process.env.SMS_PROVIDER === 'twilio'`.
- When Twilio mode is later enabled, `src/lib/sms/twilio-provider.ts` should implement `SmsProvider` against the real Twilio SDK. Don't write it now — just leave a comment placeholder.

### `src/lib/billing/stripe.ts` (same pattern)
- `StripeProvider` interface with `createCheckoutSession`, `handleWebhook`.
- `MockStripeProvider` that creates a `checkout_sessions` row in DB with status='pending', exposes `/api/dev/stripe/confirm?session=...` to flip it to 'completed' (this stands in for the Stripe webhook).
- `getBillingProvider()` returns mock unless `BILLING_PROVIDER === 'stripe'`.

### Dev webhook simulator
- `/dev/webhooks` page (only mounted when `process.env.NODE_ENV !== 'production'`):
  - Form to POST a fake Twilio status callback to `/api/webhooks/twilio/status`
  - Form to POST a fake inbound message to `/api/webhooks/twilio/inbound`
  - Form to POST a fake STOP keyword
  - List recent `sms_messages` rows so you can copy a `provider_message_id` to test with
- These handlers should work even without real Twilio credentials. The handlers should be the SAME code that real Twilio webhooks would hit.

## Stories affected by this directive
- **US-004**: Build the `SmsProvider` interface + `MockSmsProvider`. No real Twilio call.
- **US-006, US-008**: Bulk + scheduled sends use `getSmsProvider()` — never `twilio` directly.
- **US-007**: Build the Stripe interface + mock + dev simulator. Skip the real Stripe SDK.
- **US-009, US-010**: Webhook handlers should accept real Twilio webhook format. Add `/dev/webhooks` simulator page to test without Twilio credentials.
- **US-019**: STOP keyword logic is identical regardless of provider — same handler, same suppression list.

## What NOT to do
- ❌ Don't `pnpm add twilio stripe` or any related SDK.
- ❌ Don't try to read Twilio/Stripe env vars from `.env.example` (those are placeholders).
- ❌ Don't try to call real Twilio/Stripe endpoints.
- ❌ Don't write `twilio-provider.ts` or `stripe-provider.ts` until later — just the interface contracts and mock impls.
<!-- END:mock-providers-directive -->