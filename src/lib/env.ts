import { z } from "zod";

/**
 * Validated, typed environment variables.
 *
 * - Server-only secrets (DATABASE_URL, NEXTAUTH_SECRET, STRIPE_SECRET_KEY,
 *   STRIPE_WEBHOOK_SECRET, TWILIO_AUTH_TOKEN) must NEVER be bundled into
 *   client code. Only reference `env` from server components, server actions,
 *   and API route handlers.
 * - `TWILIO_ACCOUNT_SID` is treated as public because Twilio SIDs are not
 *   sensitive on their own (the auth token is the secret).
 * - `APP_URL` is the canonical public origin (no trailing slash).
 *
 * Throws at import time if a required variable is missing or malformed, so
 * the app fails fast on boot rather than at first use.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Database
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .url("DATABASE_URL must be a valid URL"),

  // Auth
  NEXTAUTH_SECRET: z
    .string()
    .min(32, "NEXTAUTH_SECRET must be at least 32 characters"),

  // Stripe
  STRIPE_SECRET_KEY: z
    .string()
    .min(1, "STRIPE_SECRET_KEY is required")
    .startsWith("sk_", "STRIPE_SECRET_KEY must start with sk_"),
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .min(1, "STRIPE_WEBHOOK_SECRET is required")
    .startsWith("whsec_", "STRIPE_WEBHOOK_SECRET must start with whsec_"),

  // Twilio
  TWILIO_ACCOUNT_SID: z
    .string()
    .min(1, "TWILIO_ACCOUNT_SID is required")
    .startsWith("AC", "TWILIO_ACCOUNT_SID must start with AC"),
  TWILIO_AUTH_TOKEN: z
    .string()
    .min(1, "TWILIO_AUTH_TOKEN is required"),

  // Public site origin
  APP_URL: z
    .string()
    .min(1, "APP_URL is required")
    .url("APP_URL must be a valid URL"),
});

export type Env = z.infer<typeof EnvSchema>;

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Pretty-print all issues, then throw. The first failure stops the
    // process so misconfiguration is obvious in deploy logs.
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables:\n${formatted}\n` +
        `See .env.example for the full list of required keys.`,
    );
  }
  return parsed.data;
}

export const env: Env = parseEnv();
