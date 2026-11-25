-- Proposal progress screen. A proposal does not have to reach 100%: parts can be resolved as done, unsure (talk to us),
-- left for staff to decide, or out of scope, and the client can submit as-is once a handoff to a human is recommended.
-- Groups, resolutions, handoff reasons, phrases, and copy are rows; per-viewer snapshots give the "since your last visit" delta.

INSERT INTO "proposal_node_state" ("code", "sort_order", "client_label", "completion_weight", "reopens_downstream", "is_reopen_target", "is_lock") VALUES
  ('unsure', 42, 'To talk through with us', 1, false, false, false),
  ('staff_decides', 44, 'Unwhelm will decide', 1, false, false, false),
  ('out_of_scope', 46, 'Out of scope for now', 1, false, false, false)
ON CONFLICT ("code") DO NOTHING;

-- Resolutions a part can be given besides agreeing it. flags_for_call puts it on the review-call agenda.
CREATE TABLE "proposal_part_resolution" (
  "state_code" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "client_can" BOOLEAN NOT NULL DEFAULT true,
  "agent_can" BOOLEAN NOT NULL DEFAULT true,
  "flags_for_call" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_part_resolution_pkey" PRIMARY KEY ("state_code")
);
ALTER TABLE "proposal_part_resolution" ADD CONSTRAINT "proposal_part_resolution_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "proposal_node_state"("code") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "proposal_part_resolution" ("state_code", "client_label", "sort_order", "client_can", "agent_can", "flags_for_call") VALUES
  ('unsure', 'Not sure, talk to a human', 10, true, true, true),
  ('staff_decides', 'Let Unwhelm decide', 20, true, true, false),
  ('out_of_scope', 'Out of scope / save for later', 30, true, true, false)
ON CONFLICT ("state_code") DO NOTHING;

-- Why the agent recommends a call with a human. turn_threshold is the "stuck after N turns" guide for the agent.
CREATE TABLE "proposal_handoff_reason" (
  "code" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "turn_threshold" INTEGER,
  "automatic" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_handoff_reason_pkey" PRIMARY KEY ("code")
);
INSERT INTO "proposal_handoff_reason" ("code", "client_label", "sort_order", "turn_threshold", "automatic") VALUES
  ('client_unsure', 'Some parts are easier to settle on a call', 10, NULL, true),
  ('scope_unbounded', 'The scope is open-ended and needs a human to bound it', 20, NULL, false),
  ('stuck', 'We have gone back and forth a few times', 30, 6, false),
  ('client_asked', 'You asked to talk to someone', 40, NULL, false)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "proposal_handoff" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "reason_code" TEXT NOT NULL,
  "note" TEXT,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleared_at" TIMESTAMP(3),
  CONSTRAINT "proposal_handoff_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "proposal_handoff_proposal_id_idx" ON "proposal_handoff"("proposal_id");
ALTER TABLE "proposal_handoff" ADD CONSTRAINT "proposal_handoff_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_handoff" ADD CONSTRAINT "proposal_handoff_reason_code_fkey" FOREIGN KEY ("reason_code") REFERENCES "proposal_handoff_reason"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Progress screen: groups, phrases, and copy are rows; per-viewer snapshots give the "since your last visit" delta.

CREATE TABLE "proposal_progress_group" (
  "code" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "settled" BOOLEAN NOT NULL DEFAULT false,
  "to_discuss" BOOLEAN NOT NULL DEFAULT false,
  "next_step_priority" INTEGER,
  "whats_left" TEXT NOT NULL,
  "next_step" TEXT NOT NULL,
  CONSTRAINT "proposal_progress_group_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_progress_state_group" (
  "state_code" TEXT NOT NULL,
  "group_code" TEXT NOT NULL,
  CONSTRAINT "proposal_progress_state_group_pkey" PRIMARY KEY ("state_code")
);
ALTER TABLE "proposal_progress_state_group" ADD CONSTRAINT "proposal_progress_state_group_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "proposal_node_state"("code") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_progress_state_group" ADD CONSTRAINT "proposal_progress_state_group_group_code_fkey" FOREIGN KEY ("group_code") REFERENCES "proposal_progress_group"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "proposal_progress_phrase" (
  "code" TEXT NOT NULL,
  "min_percent" INTEGER NOT NULL,
  "phrase" TEXT NOT NULL,
  CONSTRAINT "proposal_progress_phrase_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_progress_copy" (
  "code" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  CONSTRAINT "proposal_progress_copy_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_progress_view" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "viewer_id" UUID NOT NULL,
  "percent" INTEGER NOT NULL,
  "states" JSONB NOT NULL DEFAULT '{}',
  "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_progress_view_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "proposal_progress_view_proposal_id_viewer_id_key" ON "proposal_progress_view"("proposal_id", "viewer_id");
ALTER TABLE "proposal_progress_view" ADD CONSTRAINT "proposal_progress_view_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_progress_view" ADD CONSTRAINT "proposal_progress_view_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "proposal_progress_group" ("code", "client_label", "sort_order", "settled", "to_discuss", "next_step_priority", "whats_left", "next_step") VALUES
  ('locked', 'Locked', 10, true, false, NULL, 'Settled and locked to a version.', ''),
  ('ready', 'Done', 20, true, false, NULL, 'Agreed. It locks when the proposal is approved.', ''),
  ('to_discuss', 'To discuss with us', 22, true, true, NULL, 'Marked unsure. We will talk it through on the call.', ''),
  ('staff_decides', 'Unwhelm will decide', 24, true, false, NULL, 'Left for Unwhelm to decide during review.', ''),
  ('out_of_scope', 'Out of scope for now', 26, true, false, NULL, 'Set aside. Not part of this proposal.', ''),
  ('reopened', 'Reopened by a change', 30, false, false, 1, 'Needs another look because {reason}.', 'Take another look at {part}, since {reason}.'),
  ('needs_input', 'Needs your input', 40, false, false, 2, 'Not started yet. We need your input on {part}.', 'Tell us what you have in mind for {part}.'),
  ('in_progress', 'In progress', 50, false, false, 3, 'Drafted. Review it and agree, or ask for changes.', 'Review the draft of {part} and agree it, or ask for changes.')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_progress_state_group" ("state_code", "group_code") VALUES
  ('locked', 'locked'),
  ('agreed', 'ready'),
  ('needs_review', 'reopened'),
  ('open', 'needs_input'),
  ('drafted', 'in_progress'),
  ('unsure', 'to_discuss'),
  ('staff_decides', 'staff_decides'),
  ('out_of_scope', 'out_of_scope')
ON CONFLICT ("state_code") DO NOTHING;

INSERT INTO "proposal_progress_phrase" ("code", "min_percent", "phrase") VALUES
  ('starting', 0, 'Just getting started'),
  ('shaping', 25, 'Taking shape'),
  ('most', 50, 'More than halfway'),
  ('almost', 75, 'Almost there'),
  ('settled', 100, 'Everything is settled')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_progress_copy" ("code", "template") VALUES
  ('headline', '{settled} of {total} parts settled'),
  ('headline_discuss', '{settled} of {total} parts settled, {discuss} to discuss with us'),
  ('handoff_heading', 'Ready for a call with Unwhelm'),
  ('handoff_body', 'You do not need to finish everything. Send it as it is, and we will work through anything open or unsure together on the call.'),
  ('handoff_submit', 'Send as it is'),
  ('open_for_review', 'Still open: {parts}.'),
  ('reopened_by', '{source} changed: {change}'),
  ('reopened_by_unknown', 'something it depends on changed'),
  ('delta_down', 'Since your last visit this went from {before}% to {after}%. {reasons}'),
  ('delta_reason', 'A change to {source} ({change}) reopened {parts}.'),
  ('delta_up', 'Since your last visit this went from {before}% to {after}%. Nice progress.'),
  ('next_done', 'Everything is settled. Review the whole proposal and accept it when you are ready.'),
  ('parked_heading', 'Saved for later'),
  ('parked_note', 'These ideas are kept for a follow-up and do not count toward progress.')
ON CONFLICT ("code") DO NOTHING;
