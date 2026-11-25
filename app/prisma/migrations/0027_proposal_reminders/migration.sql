-- Reminder rules are rows. A run records due reminders in proposal_reminder as queued; nothing is sent here.
CREATE TABLE "reminder_rule" (
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "threshold_days" INTEGER NOT NULL,
    "review_states" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "label" TEXT NOT NULL,
    "message_template" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "reminder_rule_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "reminder_rule_kind_check" CHECK ("kind" IN ('near_expiry', 'state_age')),
    CONSTRAINT "reminder_rule_audience_check" CHECK ("audience" IN ('client', 'staff')),
    CONSTRAINT "reminder_rule_threshold_check" CHECK ("threshold_days" >= 0)
);

INSERT INTO "reminder_rule" ("code", "kind", "audience", "threshold_days", "review_states", "label", "message_template", "sort_order") VALUES
    ('near_expiry', 'near_expiry', 'client', 7, ARRAY[]::TEXT[], 'Proposal expires soon', '"{title}" expires in {days} days.', 10),
    ('stalled_in_review', 'state_age', 'staff', 3, ARRAY['agent_review', 'in_review', 'resubmitted', 'review_meeting_scheduled'], 'Stalled in review', '"{title}" has been in {state} for {days} days.', 20),
    ('client_no_response', 'state_age', 'client', 5, ARRAY['changes_requested', 'client_revising', 'approved'], 'Waiting on the client', '"{title}" has waited on you for {days} days.', 30)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "proposal_reminder" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "rule_code" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "anchor_key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    CONSTRAINT "proposal_reminder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_reminder_status_check" CHECK ("status" IN ('queued', 'sent', 'cancelled'))
);

CREATE UNIQUE INDEX "proposal_reminder_proposal_rule_anchor_key" ON "proposal_reminder"("proposal_id", "rule_code", "anchor_key");
CREATE INDEX "proposal_reminder_status_created_idx" ON "proposal_reminder"("status", "created_at");
ALTER TABLE "proposal_reminder" ADD CONSTRAINT "proposal_reminder_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_reminder" ADD CONSTRAINT "proposal_reminder_rule_code_fkey" FOREIGN KEY ("rule_code") REFERENCES "reminder_rule"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
