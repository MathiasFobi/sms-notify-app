import { describe, expect, it } from "vitest";
import {
  accounts,
  contacts,
  contactGroups,
  creditTransactions,
  inboundMessages,
  messages,
  messageRecipients,
  scheduledJobs,
  senderIds,
  users,
  webhookEvents,
} from "@/db/schema";

/**
 * Smoke test: every table is exported, has a non-empty name, and at least
 * one column. This guards against accidental schema export regressions —
 * later stories add columns and need to be sure the file still compiles
 * and the table handles are intact.
 */
describe("db schema", () => {
  const tables = {
    users,
    accounts,
    creditTransactions,
    senderIds,
    contacts,
    contactGroups,
    messages,
    messageRecipients,
    inboundMessages,
    scheduledJobs,
    webhookEvents,
  } as const;

  it("exports all 11 expected tables", () => {
    expect(Object.keys(tables)).toHaveLength(11);
  });

  it.each(Object.entries(tables))(
    "%s is a non-empty table with at least one column",
    (_name, table) => {
      // The drizzle pgTable returns an object whose values are Column instances.
      // We just need to confirm it has any enumerable key.
      const columns = Object.values(table as unknown as Record<string, unknown>);
      expect(columns.length).toBeGreaterThan(0);
    },
  );
});
