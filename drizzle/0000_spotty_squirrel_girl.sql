CREATE TYPE "public"."checkout_session_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('purchase', 'send', 'refund', 'bonus', 'admin_adjust');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'scheduled', 'sending', 'sent', 'delivered', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'pro');--> statement-breakpoint
CREATE TYPE "public"."recipient_status" AS ENUM('pending', 'sent', 'delivered', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."scheduled_job_status" AS ENUM('pending', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sender_id_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."webhook_source" AS ENUM('stripe', 'twilio');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkout_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"stripe_session_id" text NOT NULL,
	"package_credits" integer NOT NULL,
	"price_usd_cents" integer NOT NULL,
	"status" "checkout_session_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"phone" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"group_id" serial NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"stripe_payment_intent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"from_phone" text NOT NULL,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"twilio_message_sid" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" serial NOT NULL,
	"contact_id" serial NOT NULL,
	"phone" text NOT NULL,
	"status" "recipient_status" DEFAULT 'pending' NOT NULL,
	"twilio_message_sid" text,
	"error_code" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"body" text NOT NULL,
	"from_number" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"twilio_message_sid" text,
	"error_code" text,
	"cost_credits" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"message_id" serial NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" "scheduled_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "sender_ids" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" serial NOT NULL,
	"value" text NOT NULL,
	"status" "sender_id_status" DEFAULT 'pending' NOT NULL,
	"provider_sender_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"twilio_from_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" "webhook_source" NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_group_id_contact_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."contact_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_ids" ADD CONSTRAINT "sender_ids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_sessions_stripe_session_id_idx" ON "checkout_sessions" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE INDEX "checkout_sessions_user_id_idx" ON "checkout_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contact_groups_user_id_idx" ON "contact_groups" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_user_phone_idx" ON "contacts" USING btree ("user_id","phone");--> statement-breakpoint
CREATE INDEX "contacts_user_group_idx" ON "contacts" USING btree ("user_id","group_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_id_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_twilio_sid_idx" ON "inbound_messages" USING btree ("twilio_message_sid");--> statement-breakpoint
CREATE INDEX "inbound_messages_user_id_idx" ON "inbound_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_recipients_message_id_idx" ON "message_recipients" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_recipients_phone_idx" ON "message_recipients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "messages_user_id_idx" ON "messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_scheduled_for_idx" ON "messages" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_run_at_idx" ON "scheduled_jobs" USING btree ("run_at","status");--> statement-breakpoint
CREATE INDEX "scheduled_jobs_user_id_idx" ON "scheduled_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sender_ids_user_value_idx" ON "sender_ids" USING btree ("user_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_source_event_idx" ON "webhook_events" USING btree ("source","event_id");