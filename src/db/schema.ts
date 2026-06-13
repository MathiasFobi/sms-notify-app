import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================================================
// Enums
// ============================================================================

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const planEnum = pgEnum("plan", ["free", "starter", "pro"]);

export const creditReasonEnum = pgEnum("credit_reason", [
  "purchase",
  "send",
  "refund",
  "bonus",
  "admin_adjust",
]);

export const senderIdStatusEnum = pgEnum("sender_id_status", [
  "pending",
  "approved",
  "rejected",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "scheduled",
  "sending",
  "sent",
  "delivered",
  "failed",
  "received",
]);

export const recipientStatusEnum = pgEnum("recipient_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
  "received",
]);

export const scheduledJobStatusEnum = pgEnum("scheduled_job_status", [
  "pending",
  "running",
  "done",
  "failed",
  "cancelled",
]);

export const webhookSourceEnum = pgEnum("webhook_source", ["stripe", "twilio"]);

// ============================================================================
// Tables
// ============================================================================

/**
 * Authenticated user. Each user has exactly one account (1:1) and owns all
 * downstream resources (contacts, messages, sender IDs, etc).
 *
 * `twilioAuthToken` is stored encrypted (envelope-encrypted with a server-side
 * KMS key in production). The `text` column holds the ciphertext; we keep
 * encryption in the application layer to avoid coupling schema to key rotation.
 */
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("user"),
    twilioAccountSid: text("twilio_account_sid"),
    twilioAuthToken: text("twilio_auth_token"), // encrypted ciphertext
    twilioFromNumber: text("twilio_from_number"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

/**
 * One account per user. Holds the credit balance and Stripe linkage.
 * `credits` is the authoritative balance — credit transactions append to
 * `creditTransactions` and `credits` is updated in the same DB transaction
 * so the two never disagree.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credits: integer("credits").notNull().default(0),
    stripeCustomerId: text("stripe_customer_id"),
    plan: planEnum("plan").notNull().default("free"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("accounts_user_id_idx").on(table.userId)],
);

/**
 * Append-only ledger of every credit change. Always pair with an update to
 * `accounts.credits` in the same transaction.
 */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: creditReasonEnum("reason").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("credit_transactions_user_id_idx").on(table.userId)],
);

/**
 * A sender ID (alphanumeric or dedicated number) that a user has registered
 * with the upstream provider. Unique per user.
 */
export const senderIds = pgTable(
  "sender_ids",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    status: senderIdStatusEnum("status").notNull().default("pending"),
    providerSenderId: text("provider_sender_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sender_ids_user_value_idx").on(table.userId, table.value),
  ],
);

/**
 * A contact list a user can group contacts into.
 */
export const contactGroups = pgTable(
  "contact_groups",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("contact_groups_user_id_idx").on(table.userId)],
);

/**
 * A single contact (phone number) owned by a user. Uniqueness is on
 * (userId, phone) so the same person can be a contact of multiple users.
 *
 * `optedOut` is the global per-contact flag — it must be honored by every
 * send path. Group-level suppression is layered on top in the app code.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    groupId: serial("group_id").references(() => contactGroups.id, {
      onDelete: "set null",
    }),
    optedOut: boolean("opted_out").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("contacts_user_phone_idx").on(table.userId, table.phone),
    index("contacts_user_group_idx").on(table.userId, table.groupId),
  ],
);

/**
 * A message a user sends. One row per send. Recipients live in
 * `messageRecipients` so we can track per-recipient delivery state.
 */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    fromNumber: text("from_number").notNull(),
    status: messageStatusEnum("status").notNull().default("queued"),
    twilioMessageSid: text("twilio_message_sid"),
    errorCode: text("error_code"),
    costCredits: integer("cost_credits").notNull().default(0),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("messages_user_id_idx").on(table.userId),
    index("messages_status_idx").on(table.status),
    index("messages_scheduled_for_idx").on(table.scheduledFor),
  ],
);

/**
 * Per-recipient delivery record for each message. We snapshot the phone
 * number at send time so that deleting the contact later doesn't break the
 * delivery report.
 */
export const messageRecipients = pgTable(
  "message_recipients",
  {
    id: serial("id").primaryKey(),
    messageId: serial("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    contactId: serial("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    phone: text("phone").notNull(),
    status: recipientStatusEnum("status").notNull().default("pending"),
    twilioMessageSid: text("twilio_message_sid"),
    errorCode: text("error_code"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("message_recipients_message_id_idx").on(table.messageId),
    index("message_recipients_phone_idx").on(table.phone),
  ],
);

/**
 * Inbound messages received on a user's Twilio number.
 * `twilioMessageSid` is unique globally (Twilio guarantees this) and is
 * used to dedupe retries of the same webhook delivery.
 */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromPhone: text("from_phone").notNull(),
    toNumber: text("to_number").notNull(),
    body: text("body").notNull(),
    twilioMessageSid: text("twilio_message_sid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("inbound_messages_twilio_sid_idx").on(table.twilioMessageSid),
    index("inbound_messages_user_id_idx").on(table.userId),
  ],
);

/**
 * Scheduled-send jobs. Picked up by a worker (cron / queue) and dispatched
 * when `runAt` is in the past and `status` is `pending`.
 */
export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: serial("id").primaryKey(),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: serial("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    status: scheduledJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    index("scheduled_jobs_run_at_idx").on(table.runAt, table.status),
    index("scheduled_jobs_user_id_idx").on(table.userId),
  ],
);

/**
 * Idempotency log for inbound webhooks. Every Stripe and Twilio webhook
 * is recorded with its provider event id so retries are safe.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    source: webhookSourceEnum("source").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("webhook_events_source_event_idx").on(
      table.source,
      table.eventId,
    ),
  ],
);

// ============================================================================
// Relations
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  account: one(accounts, {
    fields: [users.id],
    references: [accounts.userId],
  }),
  contacts: many(contacts),
  contactGroups: many(contactGroups),
  messages: many(messages),
  senderIds: many(senderIds),
  inboundMessages: many(inboundMessages),
  scheduledJobs: many(scheduledJobs),
  creditTransactions: many(creditTransactions),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  user: one(users, { fields: [contacts.userId], references: [users.id] }),
  group: one(contactGroups, {
    fields: [contacts.groupId],
    references: [contactGroups.id],
  }),
}));

export const contactGroupsRelations = relations(contactGroups, ({ one }) => ({
  user: one(users, {
    fields: [contactGroups.userId],
    references: [users.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  user: one(users, { fields: [messages.userId], references: [users.id] }),
  recipients: many(messageRecipients),
  scheduledJobs: many(scheduledJobs),
}));

export const messageRecipientsRelations = relations(
  messageRecipients,
  ({ one }) => ({
    message: one(messages, {
      fields: [messageRecipients.messageId],
      references: [messages.id],
    }),
    contact: one(contacts, {
      fields: [messageRecipients.contactId],
      references: [contacts.id],
    }),
  }),
);

export const scheduledJobsRelations = relations(scheduledJobs, ({ one }) => ({
  user: one(users, { fields: [scheduledJobs.userId], references: [users.id] }),
  message: one(messages, {
    fields: [scheduledJobs.messageId],
    references: [messages.id],
  }),
}));

export const inboundMessagesRelations = relations(inboundMessages, ({ one }) => ({
  user: one(users, {
    fields: [inboundMessages.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// Convenience: keep the `now()` default in code in case we ever need it
// outside of column defaults.
// ============================================================================

export const now = (): ReturnType<typeof sql> => sql`now()`;

// ============================================================================
// Inferred types — handy in app code (e.g. `type User = typeof users.$inferSelect`)
// ============================================================================

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;
export type SenderId = typeof senderIds.$inferSelect;
export type NewSenderId = typeof senderIds.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactGroup = typeof contactGroups.$inferSelect;
export type NewContactGroup = typeof contactGroups.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageRecipient = typeof messageRecipients.$inferSelect;
export type NewMessageRecipient = typeof messageRecipients.$inferInsert;
export type InboundMessage = typeof inboundMessages.$inferSelect;
export type NewInboundMessage = typeof inboundMessages.$inferInsert;
export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
