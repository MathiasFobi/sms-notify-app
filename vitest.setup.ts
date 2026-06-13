/**
 * Vitest setup: provide the env vars that src/lib/env.ts requires.
 *
 * Real env validation runs in src/lib/env.ts at import time, which is the
 * behavior we want in the app. For unit tests we just need *some* values
 * present so the module loads — the values themselves aren't under test.
 *
 * The shape and required keys are what's tested; see env.test.ts.
 *
 * We cast `process.env` to a mutable view because @types/node ships
 * `process.env` as deeply read-only; we are intentionally writing test
 * fixtures here, never production env.
 */
const testEnv = process.env as unknown as Record<string, string | undefined>;

testEnv["NODE_ENV"] ??= "test";
testEnv["DATABASE_URL"] ??=
  "postgres://test:test@localhost:5432/sms_notify_app_test";
testEnv["AUTH_SECRET"] ??= "test-secret-that-is-at-least-32-chars-long";
testEnv["STRIPE_SECRET_KEY"] ??= "sk_test_placeholder";
testEnv["STRIPE_WEBHOOK_SECRET"] ??= "whsec_placeholder";
testEnv["TWILIO_ACCOUNT_SID"] ??= "ACplaceholder";
testEnv["TWILIO_AUTH_TOKEN"] ??= "placeholder";
testEnv["APP_URL"] ??= "http://localhost:3000";
