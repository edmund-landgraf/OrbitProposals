-- Proposal review states, transitions, comments, flags, versions, and meetings.
-- Allowed moves, labels, phrase list, reason codes, and length limits are rows.

ALTER TABLE "Proposal" ADD COLUMN "review_state" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "Proposal" ADD COLUMN "approved_version_id" UUID;

CREATE INDEX "Proposal_review_state_idx" ON "Proposal"("review_state");

CREATE TABLE "proposal_review_status" (
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "client_label" TEXT NOT NULL,
  "staff_label" TEXT NOT NULL,
  "terminal" BOOLEAN NOT NULL DEFAULT false,
  "client_editable" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_review_status_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_transition" (
  "id" UUID NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "requires_reason" BOOLEAN NOT NULL DEFAULT false,
  "requires_comment" BOOLEAN NOT NULL DEFAULT false,
  "snapshots" BOOLEAN NOT NULL DEFAULT false,
  "locks_version" BOOLEAN NOT NULL DEFAULT false,
  "clears_approved_version" BOOLEAN NOT NULL DEFAULT false,
  "blocked_by_open_flags" BOOLEAN NOT NULL DEFAULT false,
  "runs_unbounded_check" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_review_transition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_review_transition_from_status_to_status_actor_role_key" ON "proposal_review_transition"("from_status", "to_status", "actor_role");
CREATE INDEX "proposal_review_transition_from_status_actor_role_idx" ON "proposal_review_transition"("from_status", "actor_role");

CREATE TABLE "proposal_review_comment_type" (
  "code" TEXT NOT NULL,
  "blocks_approval" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_review_comment_type_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_visibility" (
  "code" TEXT NOT NULL,
  CONSTRAINT "proposal_review_visibility_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_comment_status" (
  "code" TEXT NOT NULL,
  "open" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_review_comment_status_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_reason_code" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "applies_to" TEXT NOT NULL,
  CONSTRAINT "proposal_review_reason_code_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_phrase" (
  "id" UUID NOT NULL,
  "phrase" TEXT NOT NULL,
  CONSTRAINT "proposal_review_phrase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_review_phrase_phrase_key" ON "proposal_review_phrase"("phrase");

CREATE TABLE "proposal_review_check" (
  "code" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "proposal_review_check_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_limit" (
  "code" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "proposal_review_limit_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_review_flag_kind" (
  "code" TEXT NOT NULL,
  "blocks_approval" BOOLEAN NOT NULL DEFAULT true,
  "allowed_roles" TEXT NOT NULL,
  CONSTRAINT "proposal_review_flag_kind_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_version" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "reason" TEXT,
  CONSTRAINT "proposal_version_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_version_proposal_id_number_key" ON "proposal_version"("proposal_id", "number");
CREATE INDEX "proposal_version_proposal_id_number_idx" ON "proposal_version"("proposal_id", "number");

ALTER TABLE "proposal_version" ADD CONSTRAINT "proposal_version_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_approved_version_id_fkey" FOREIGN KEY ("approved_version_id") REFERENCES "proposal_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Contract" ADD COLUMN "proposal_version_id" UUID;
CREATE INDEX "Contract_proposal_version_id_idx" ON "Contract"("proposal_version_id");
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "proposal_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "proposal_review_comment" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "parent_id" UUID,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT,
  "type_code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "visibility" TEXT NOT NULL,
  "author_role" TEXT NOT NULL,
  "author_id" UUID,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_review_comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_review_comment_proposal_id_status_idx" ON "proposal_review_comment"("proposal_id", "status");
ALTER TABLE "proposal_review_comment" ADD CONSTRAINT "proposal_review_comment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_review_comment" ADD CONSTRAINT "proposal_review_comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "proposal_review_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_review_flag" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "target_kind" TEXT NOT NULL,
  "target_id" TEXT,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "visibility" TEXT NOT NULL,
  "author_role" TEXT NOT NULL,
  "author_id" UUID,
  "blocks_approval" BOOLEAN NOT NULL,
  "automatic" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_review_flag_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_review_flag_proposal_id_status_idx" ON "proposal_review_flag"("proposal_id", "status");
ALTER TABLE "proposal_review_flag" ADD CONSTRAINT "proposal_review_flag_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_review_event" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "actor_id" UUID,
  "actor_role" TEXT NOT NULL,
  "from_status" TEXT NOT NULL,
  "to_status" TEXT NOT NULL,
  "reason_code" TEXT,
  "reason_text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_review_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_review_event_proposal_id_created_at_idx" ON "proposal_review_event"("proposal_id", "created_at");
ALTER TABLE "proposal_review_event" ADD CONSTRAINT "proposal_review_event_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_review_meeting" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "scheduled_at" TIMESTAMP(3) NOT NULL,
  "link" TEXT,
  "notes" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_review_meeting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_review_meeting_proposal_id_key" ON "proposal_review_meeting"("proposal_id");
ALTER TABLE "proposal_review_meeting" ADD CONSTRAINT "proposal_review_meeting_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "proposal_review_status" ("code", "sort_order", "client_label", "staff_label", "terminal", "client_editable") VALUES
  ('draft', 10, 'Draft', 'Draft', false, true),
  ('agent_review', 20, 'With Unwhelm', 'Agent review', false, false),
  ('in_review', 30, 'In review', 'Staff review', false, false),
  ('changes_requested', 40, 'Changes requested', 'Changes requested', false, false),
  ('client_revising', 50, 'Revising', 'Client revising', false, true),
  ('resubmitted', 60, 'Resubmitted', 'Resubmitted', false, false),
  ('review_meeting_scheduled', 70, 'Review call scheduled', 'Review meeting scheduled', false, false),
  ('approved', 80, 'Approved', 'Approved', true, false),
  ('rejected', 90, 'Declined', 'Rejected', true, false),
  ('withdrawn', 100, 'Withdrawn', 'Withdrawn', true, false);

INSERT INTO "proposal_review_comment_type" ("code", "blocks_approval") VALUES
  ('question', false),
  ('pushback', false),
  ('clarification', false),
  ('needs_bounding', true);

INSERT INTO "proposal_review_visibility" ("code") VALUES ('internal'), ('client');

INSERT INTO "proposal_review_comment_status" ("code", "open") VALUES ('open', true), ('resolved', false);

INSERT INTO "proposal_review_reason_code" ("code", "label", "applies_to") VALUES
  ('budget', 'Budget', 'reject,withdraw'),
  ('timing', 'Timing', 'reject,withdraw'),
  ('scope', 'Scope', 'reject,withdraw'),
  ('chose_other', 'Chose someone else', 'reject,withdraw'),
  ('other', 'Other', 'reject,withdraw');

INSERT INTO "proposal_review_phrase" ("id", "phrase") VALUES
  ('10000000-0000-4000-8000-000000000001', 'as needed'),
  ('10000000-0000-4000-8000-000000000002', 'ongoing'),
  ('10000000-0000-4000-8000-000000000003', 'unlimited'),
  ('10000000-0000-4000-8000-000000000004', 'open-ended'),
  ('10000000-0000-4000-8000-000000000005', 'tbd'),
  ('10000000-0000-4000-8000-000000000006', 'to be determined'),
  ('10000000-0000-4000-8000-000000000007', 'until complete'),
  ('10000000-0000-4000-8000-000000000008', 'as required');

INSERT INTO "proposal_review_check" ("code", "kind", "enabled") VALUES
  ('missing_total', 'missing_total', true),
  ('missing_hour_cap', 'missing_hour_cap', true),
  ('open_ended_phrase', 'phrase', true);

INSERT INTO "proposal_review_limit" ("code", "value") VALUES
  ('comment_body_max', 4000),
  ('reason_text_max', 2000),
  ('meeting_notes_max', 2000),
  ('meeting_link_max', 500);

INSERT INTO "proposal_review_flag_kind" ("code", "blocks_approval", "allowed_roles") VALUES
  ('unbounded', true, 'staff,agent');

INSERT INTO "proposal_review_transition" (
  "id", "from_status", "to_status", "actor_role", "action", "label",
  "requires_reason", "requires_comment", "snapshots", "locks_version", "clears_approved_version", "blocked_by_open_flags", "runs_unbounded_check"
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'draft', 'agent_review', 'agent', 'submit', 'Submit for agent review', false, false, true, false, false, false, true),
  ('20000000-0000-4000-8000-000000000002', 'draft', 'agent_review', 'staff', 'submit', 'Submit for agent review', false, false, true, false, false, false, true),
  ('20000000-0000-4000-8000-000000000003', 'agent_review', 'in_review', 'agent', 'handoff', 'Hand to staff', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000004', 'agent_review', 'in_review', 'staff', 'handoff', 'Start staff review', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000005', 'agent_review', 'review_meeting_scheduled', 'staff', 'schedule_meeting', 'Schedule review call', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000006', 'in_review', 'changes_requested', 'staff', 'request_changes', 'Request changes', false, true, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000007', 'in_review', 'review_meeting_scheduled', 'staff', 'schedule_meeting', 'Schedule review call', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000008', 'in_review', 'approved', 'staff', 'approve', 'Approve', false, false, false, true, false, true, true),
  ('20000000-0000-4000-8000-000000000009', 'in_review', 'rejected', 'staff', 'reject', 'Decline', true, true, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000010', 'review_meeting_scheduled', 'in_review', 'staff', 'handoff', 'Return to staff review', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000011', 'review_meeting_scheduled', 'changes_requested', 'staff', 'request_changes', 'Request changes', false, true, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000012', 'review_meeting_scheduled', 'approved', 'staff', 'approve', 'Approve', false, false, true, true, false, true, true),
  ('20000000-0000-4000-8000-000000000013', 'review_meeting_scheduled', 'rejected', 'staff', 'reject', 'Decline', true, true, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000014', 'changes_requested', 'client_revising', 'client', 'start_revision', 'Start revision', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000015', 'client_revising', 'resubmitted', 'client', 'resubmit', 'Resubmit', false, false, true, false, false, false, false),
  ('20000000-0000-4000-8000-000000000016', 'client_revising', 'resubmitted', 'agent', 'resubmit', 'Resubmit', false, false, true, false, false, false, false),
  ('20000000-0000-4000-8000-000000000017', 'resubmitted', 'in_review', 'staff', 'take_up', 'Take up resubmission', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000018', 'resubmitted', 'agent_review', 'agent', 'handoff', 'Review again', false, false, false, false, false, false, true),
  ('20000000-0000-4000-8000-000000000019', 'resubmitted', 'review_meeting_scheduled', 'staff', 'schedule_meeting', 'Schedule review call', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000020', 'approved', 'in_review', 'client', 'reopen', 'Edit after approval', false, false, true, false, true, false, false),
  ('20000000-0000-4000-8000-000000000021', 'approved', 'in_review', 'staff', 'reopen', 'Edit after approval', false, false, true, false, true, false, false),
  ('20000000-0000-4000-8000-000000000022', 'approved', 'in_review', 'agent', 'reopen', 'Edit after approval', false, false, true, false, true, false, false),
  ('20000000-0000-4000-8000-000000000023', 'draft', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000024', 'agent_review', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000025', 'in_review', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000026', 'changes_requested', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000027', 'client_revising', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000028', 'resubmitted', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000029', 'review_meeting_scheduled', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000030', 'approved', 'withdrawn', 'client', 'withdraw', 'Withdraw', true, false, false, false, false, false, false);
