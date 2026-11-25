-- Reminder delivery: client contact preferences, per-rule templates, a delivery log with retries,
-- and client-set ticklers for unfinished proposals. Every label, limit, and template is a row.

-- Channels a client can choose at intake.
CREATE TABLE "contact_channel" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sends_email" BOOLEAN NOT NULL DEFAULT false,
  "sends_sms" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "contact_channel_pkey" PRIMARY KEY ("code")
);
INSERT INTO "contact_channel" ("code", "label", "sends_email", "sends_sms", "sort_order") VALUES
  ('email', 'Email', true, false, 10),
  ('sms', 'Text message', false, true, 20),
  ('both', 'Email and text', true, true, 30),
  ('none', 'Please don''t remind me', false, false, 40)
ON CONFLICT ("code") DO NOTHING;

-- One preference per user. organization_id records the org it was captured under.
CREATE TABLE "contact_preference" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "organization_id" UUID,
  "channel" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "consent_at" TIMESTAMP(3),
  "consent_source" TEXT,
  "quiet_start" TEXT,
  "quiet_end" TEXT,
  "timezone" TEXT,
  "opted_out_at" TIMESTAMP(3),
  "opt_out_source" TEXT,
  "unsubscribe_token" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_preference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contact_preference_user_id_key" ON "contact_preference"("user_id");
CREATE UNIQUE INDEX "contact_preference_unsubscribe_token_key" ON "contact_preference"("unsubscribe_token");
CREATE INDEX "contact_preference_phone_idx" ON "contact_preference"("phone");
ALTER TABLE "contact_preference" ADD CONSTRAINT "contact_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_preference" ADD CONSTRAINT "contact_preference_channel_fkey" FOREIGN KEY ("channel") REFERENCES "contact_channel"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Delivery and tickler settings. int_value or text_value per row.
CREATE TABLE "reminder_delivery_setting" (
  "code" TEXT NOT NULL,
  "int_value" INTEGER,
  "text_value" TEXT,
  "description" TEXT NOT NULL,
  CONSTRAINT "reminder_delivery_setting_pkey" PRIMARY KEY ("code")
);
INSERT INTO "reminder_delivery_setting" ("code", "int_value", "text_value", "description") VALUES
  ('max_attempts', 5, NULL, 'Send attempts per delivery before it is marked failed.'),
  ('backoff_base_minutes', 15, NULL, 'First retry delay; doubles each attempt.'),
  ('rate_limit_per_day', 3, NULL, 'Most reminders sent to one person in 24 hours.'),
  ('default_quiet_start', NULL, '21:00', 'Quiet hours start when the client has not set them.'),
  ('default_quiet_end', NULL, '08:00', 'Quiet hours end when the client has not set them.'),
  ('default_timezone', NULL, 'America/Los_Angeles', 'Timezone when the client has not set one.'),
  ('portal_base_url', NULL, 'https://unwhelm.com', 'Base URL for portal and unsubscribe links.'),
  ('sms_stop_words', NULL, 'STOP,STOPALL,UNSUBSCRIBE,CANCEL,END,QUIT,OPTOUT', 'Inbound SMS words that opt the sender out.'),
  ('sms_start_words', NULL, 'START,UNSTOP,YES', 'Inbound SMS words that opt the sender back in.'),
  ('tickler_max_count', 5, NULL, 'Most ticklers sent for one proposal before they stop.'),
  ('tickler_stop_after_expiry', 1, NULL, '1 stops ticklers once the proposal has expired.'),
  ('tickler_default_time', NULL, '09:00', 'Time of day a tickler goes out when the client does not pick one.'),
  ('tickler_min_interval_days', 1, NULL, 'Shortest repeat interval a client can choose.'),
  ('tickler_max_interval_days', 30, NULL, 'Longest repeat interval or snooze a client can choose.'),
  ('progress_fallback', NULL, 'Your proposal is saved where you left it.', 'Reminder {progress} text when the proposal has no completion parts yet.'),
  ('next_step_fallback', NULL, 'Open the proposal and keep going.', 'Reminder {next_step} text when there is no next step.')
ON CONFLICT ("code") DO NOTHING;

-- Tickler schedules a client can pick.
CREATE TABLE "tickler_option" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "repeats" BOOLEAN NOT NULL DEFAULT false,
  "default_days" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "tickler_option_pkey" PRIMARY KEY ("code")
);
INSERT INTO "tickler_option" ("code", "label", "repeats", "default_days", "sort_order") VALUES
  ('tomorrow_at', 'Tomorrow at a time I pick', false, 1, 10),
  ('snooze', 'In a few days', false, 3, 20),
  ('every_n_days', 'Every few days until I finish', true, 3, 30),
  ('weekly', 'Once a week on a day I pick', true, 7, 40)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "proposal_tickler" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "option_code" TEXT NOT NULL,
  "interval_days" INTEGER,
  "weekday" INTEGER,
  "time_of_day" TEXT NOT NULL,
  "next_at" TIMESTAMP(3),
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "stopped_at" TIMESTAMP(3),
  "stop_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_tickler_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_tickler_weekday_check" CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6)
);
CREATE UNIQUE INDEX "proposal_tickler_proposal_id_key" ON "proposal_tickler"("proposal_id");
CREATE INDEX "proposal_tickler_next_at_idx" ON "proposal_tickler"("next_at");
ALTER TABLE "proposal_tickler" ADD CONSTRAINT "proposal_tickler_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_tickler" ADD CONSTRAINT "proposal_tickler_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_tickler" ADD CONSTRAINT "proposal_tickler_option_code_fkey" FOREIGN KEY ("option_code") REFERENCES "tickler_option"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ticklers are a reminder rule too, so they share the queue, templates, and delivery log.
ALTER TABLE "reminder_rule" DROP CONSTRAINT "reminder_rule_kind_check";
ALTER TABLE "reminder_rule" ADD CONSTRAINT "reminder_rule_kind_check" CHECK ("kind" IN ('near_expiry', 'state_age', 'tickler'));
INSERT INTO "reminder_rule" ("code", "kind", "audience", "threshold_days", "review_states", "label", "message_template", "sort_order") VALUES
  ('tickler', 'tickler', 'client', 0, ARRAY['draft', 'client_revising'], 'Pick up where you left off', '"{title}": {progress}', 40)
ON CONFLICT ("code") DO NOTHING;

-- Templates per rule and channel. Variables: {client_name} {proposal_title} {portal_link} {expiry_date} {days} {progress} {next_step} {unsubscribe_link}.
CREATE TABLE "reminder_template" (
  "rule_code" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  CONSTRAINT "reminder_template_pkey" PRIMARY KEY ("rule_code", "channel"),
  CONSTRAINT "reminder_template_channel_check" CHECK ("channel" IN ('email', 'sms'))
);
ALTER TABLE "reminder_template" ADD CONSTRAINT "reminder_template_rule_code_fkey" FOREIGN KEY ("rule_code") REFERENCES "reminder_rule"("code") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "reminder_template" ("rule_code", "channel", "subject", "body") VALUES
  ('near_expiry', 'email', 'Your proposal "{proposal_title}" expires {expiry_date}', E'Hi {client_name},\n\nYour proposal "{proposal_title}" expires on {expiry_date}. You can review it here: {portal_link}\n\nNo longer want these reminders? {unsubscribe_link}'),
  ('near_expiry', 'sms', NULL, 'Unwhelm: "{proposal_title}" expires {expiry_date}. {portal_link} Reply STOP to opt out.'),
  ('client_no_response', 'email', 'We''re waiting on you for "{proposal_title}"', E'Hi {client_name},\n\n"{proposal_title}" is waiting on you. {progress}\n\nPick it up here: {portal_link}\n\nNo longer want these reminders? {unsubscribe_link}'),
  ('client_no_response', 'sms', NULL, 'Unwhelm: "{proposal_title}" is waiting on you. {portal_link} Reply STOP to opt out.'),
  ('tickler', 'email', 'Pick up "{proposal_title}" where you left off', E'Hi {client_name},\n\nHere''s where "{proposal_title}" stands: {progress}\nNext step: {next_step}\n\nPick up where you left off: {portal_link}\n\nYou can change or stop these reminders in the portal. Unsubscribe from all reminders: {unsubscribe_link}'),
  ('tickler', 'sms', NULL, 'Unwhelm: "{proposal_title}" - {progress} Next: {next_step} {portal_link} Reply STOP to opt out.')
ON CONFLICT ("rule_code", "channel") DO NOTHING;

-- One row per reminder and channel: idempotent, with attempts, backoff, and errors.
CREATE TABLE "reminder_delivery" (
  "id" UUID NOT NULL,
  "reminder_id" UUID NOT NULL,
  "user_id" UUID,
  "channel" TEXT NOT NULL,
  "destination" TEXT,
  "provider" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "provider_message_id" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reminder_delivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reminder_delivery_channel_check" CHECK ("channel" IN ('email', 'sms')),
  CONSTRAINT "reminder_delivery_status_check" CHECK ("status" IN ('pending', 'deferred', 'sent', 'failed', 'skipped'))
);
CREATE UNIQUE INDEX "reminder_delivery_reminder_channel_key" ON "reminder_delivery"("reminder_id", "channel");
CREATE INDEX "reminder_delivery_status_next_idx" ON "reminder_delivery"("status", "next_attempt_at");
CREATE INDEX "reminder_delivery_user_sent_idx" ON "reminder_delivery"("user_id", "sent_at");
ALTER TABLE "reminder_delivery" ADD CONSTRAINT "reminder_delivery_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "proposal_reminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
