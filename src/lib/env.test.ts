import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";

describe("env validation", () => {
  it("exposes a typed env object with required keys", () => {
    // Required keys must all be present. The presence of each is what we test —
    // actual values vary per environment, but the keys are stable.
    for (const key of [
      "DATABASE_URL",
      "NEXTAUTH_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "APP_URL",
    ]) {
      expect(env).toHaveProperty(key);
      expect(typeof (env as Record<string, unknown>)[key]).toBe("string");
    }
  });

  it("APP_URL is a valid http(s) URL", () => {
    expect(() => new URL(env.APP_URL)).not.toThrow();
    expect(["http:", "https:"]).toContain(new URL(env.APP_URL).protocol);
  });
});
