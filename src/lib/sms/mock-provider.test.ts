import { afterEach, describe, expect, it } from "vitest";
import { MockSmsProvider } from "@/lib/sms/mock-provider";
import { __resetSmsProviderForTests, getSmsProvider } from "@/lib/sms";

describe("MockSmsProvider", () => {
  afterEach(() => {
    __resetSmsProviderForTests();
  });

  describe("send()", () => {
    it("returns the expected success shape", async () => {
      const provider = new MockSmsProvider();
      const result = await provider.send({
        to: "+15551234567",
        body: "hello world",
      });

      expect(result.ok).toBe(true);
      expect(result.providerMessageId).toMatch(/^mock_[0-9a-f-]{36}$/);
      expect(result.priceUsd).toBe(0.0079);
      expect(result.segments).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it("generates a unique providerMessageId on every call", async () => {
      const provider = new MockSmsProvider();
      const ids = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const r = await provider.send({ to: "+15551234567", body: "x" });
        expect(r.providerMessageId).toBeDefined();
        ids.add(r.providerMessageId!);
      }
      // 10 distinct ids → all unique.
      expect(ids.size).toBe(10);
    });

    it("rejects messages missing a `to`", async () => {
      const provider = new MockSmsProvider();
      // @ts-expect-error — intentionally invalid for the test
      const result = await provider.send({ body: "hello" });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects messages missing a `body`", async () => {
      const provider = new MockSmsProvider();
      // @ts-expect-error — intentionally invalid for the test
      const result = await provider.send({ to: "+15551234567" });
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("fetch()", () => {
    it("returns the same status that send() produced", async () => {
      const provider = new MockSmsProvider();
      const sent = await provider.send({ to: "+15551234567", body: "hi" });
      expect(sent.ok).toBe(true);

      const fetched = await provider.fetch(sent.providerMessageId!);
      expect(fetched).not.toBeNull();
      expect(fetched!.providerMessageId).toBe(sent.providerMessageId);
      // Mock defaults to "sent" — the test below covers the override path.
      expect(fetched!.status).toBe(MockSmsProvider.DEFAULT_STATUS);
      expect(fetched!.priceUsd).toBe(sent.priceUsd);
      expect(fetched!.segments).toBe(sent.segments);
    });

    it("returns null for an unknown id", async () => {
      const provider = new MockSmsProvider();
      const result = await provider.fetch("mock_unknown");
      expect(result).toBeNull();
    });

    it("returns null when given an empty string", async () => {
      const provider = new MockSmsProvider();
      const result = await provider.fetch("");
      expect(result).toBeNull();
    });

    it("reflects status changes made via setStatus()", async () => {
      const provider = new MockSmsProvider();
      const sent = await provider.send({ to: "+15551234567", body: "hi" });
      const id = sent.providerMessageId!;

      expect(provider.setStatus(id, "delivered")).toBe(true);
      const fetched = await provider.fetch(id);
      expect(fetched!.status).toBe("delivered");

      expect(provider.setStatus(id, "failed")).toBe(true);
      const fetched2 = await provider.fetch(id);
      expect(fetched2!.status).toBe("failed");
    });
  });
});

describe("getSmsProvider()", () => {
  afterEach(() => {
    __resetSmsProviderForTests();
  });

  it("returns a MockSmsProvider by default", () => {
    // Ensure no leftover env from another test.
    const original = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;

    try {
      const provider = getSmsProvider();
      expect(provider).toBeInstanceOf(MockSmsProvider);
    } finally {
      if (original !== undefined) process.env.SMS_PROVIDER = original;
    }
  });

  it("returns the same singleton instance on repeated calls", () => {
    const original = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;

    try {
      const a = getSmsProvider();
      const b = getSmsProvider();
      expect(a).toBe(b);
    } finally {
      if (original !== undefined) process.env.SMS_PROVIDER = original;
    }
  });

  it("throws when SMS_PROVIDER=twilio (not implemented yet)", () => {
    const original = process.env.SMS_PROVIDER;
    process.env.SMS_PROVIDER = "twilio";

    try {
      expect(() => getSmsProvider()).toThrow(/not implemented/i);
    } finally {
      if (original === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = original;
    }
  });

  it("__resetSmsProviderForTests() yields a fresh instance", () => {
    const original = process.env.SMS_PROVIDER;
    delete process.env.SMS_PROVIDER;

    try {
      const a = getSmsProvider();
      __resetSmsProviderForTests();
      const b = getSmsProvider();
      expect(a).not.toBe(b);
    } finally {
      if (original !== undefined) process.env.SMS_PROVIDER = original;
    }
  });
});
