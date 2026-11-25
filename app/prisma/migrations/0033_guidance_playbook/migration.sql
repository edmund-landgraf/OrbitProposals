-- Guidance playbook (Approach A): rules over computed signals suggest the agent's next move; every agent turn and the
-- session outcome are logged so a nightly job can score rules, and staff feedback seeds a future case library (Approach B).
-- Signals, moves, outcome codes, and rules are rows (REFACTOR.md). FKs live in SQL only.

CREATE TABLE "guidance_signal_def" (
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "value_type" TEXT NOT NULL,
  "computation_hint" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "guidance_signal_def_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "guidance_signal_def_value_type_check" CHECK ("value_type" IN ('integer', 'number', 'percent', 'boolean', 'minutes'))
);

CREATE TABLE "guidance_move" (
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "guidance_move_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "guidance_outcome_code" (
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "polarity" INTEGER NOT NULL DEFAULT 0,
  "terminal" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "guidance_outcome_code_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "guidance_outcome_code_polarity_check" CHECK ("polarity" IN (-1, 0, 1))
);

CREATE TABLE "guidance_rule" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "base_weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "learned_weight" DOUBLE PRECISION,
  "trigger" TEXT NOT NULL DEFAULT 'turn',
  "condition" JSONB NOT NULL,
  "suggested_move" TEXT NOT NULL,
  "client_phrase" TEXT NOT NULL,
  "staff_note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guidance_rule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guidance_rule_trigger_check" CHECK ("trigger" IN ('turn', 'node_changed', 'pause', 'resume', 'submit_attempt'))
);
CREATE UNIQUE INDEX "guidance_rule_key_key" ON "guidance_rule"("key");
CREATE INDEX "guidance_rule_trigger_enabled_idx" ON "guidance_rule"("trigger", "enabled");
ALTER TABLE "guidance_rule" ADD CONSTRAINT "guidance_rule_suggested_move_fkey" FOREIGN KEY ("suggested_move") REFERENCES "guidance_move"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guidance_rule" ADD CONSTRAINT "guidance_rule_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One row per agent turn. fired_rule_ids are guidance_rule ids (no per-element FK; rules are disabled, not deleted).
CREATE TABLE "guidance_session_event" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "session_id" TEXT NOT NULL,
  "turn_index" INTEGER NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'turn',
  "signals" JSONB NOT NULL DEFAULT '{}',
  "fired_rule_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "chosen_move" TEXT,
  "action_taken" TEXT,
  "completion_before" INTEGER,
  "completion_after" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guidance_session_event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "guidance_session_event_session_id_turn_index_key" ON "guidance_session_event"("session_id", "turn_index");
CREATE INDEX "guidance_session_event_proposal_id_created_at_idx" ON "guidance_session_event"("proposal_id", "created_at");
CREATE INDEX "guidance_session_event_fired_rule_ids_idx" ON "guidance_session_event" USING GIN ("fired_rule_ids");
ALTER TABLE "guidance_session_event" ADD CONSTRAINT "guidance_session_event_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guidance_session_event" ADD CONSTRAINT "guidance_session_event_chosen_move_fkey" FOREIGN KEY ("chosen_move") REFERENCES "guidance_move"("key") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "guidance_outcome" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "session_id" TEXT,
  "outcome_code" TEXT NOT NULL,
  "event_id" UUID,
  "note" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guidance_outcome_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "guidance_outcome_proposal_id_idx" ON "guidance_outcome"("proposal_id");
CREATE INDEX "guidance_outcome_session_id_idx" ON "guidance_outcome"("session_id");
CREATE INDEX "guidance_outcome_outcome_code_occurred_at_idx" ON "guidance_outcome"("outcome_code", "occurred_at");
ALTER TABLE "guidance_outcome" ADD CONSTRAINT "guidance_outcome_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guidance_outcome" ADD CONSTRAINT "guidance_outcome_outcome_code_fkey" FOREIGN KEY ("outcome_code") REFERENCES "guidance_outcome_code"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guidance_outcome" ADD CONSTRAINT "guidance_outcome_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "guidance_session_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Nightly scoring output. period like '2026-10-23' or '2026-W43'.
CREATE TABLE "guidance_rule_score" (
  "id" UUID NOT NULL,
  "rule_id" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "fires" INTEGER NOT NULL DEFAULT 0,
  "positive_outcomes" INTEGER NOT NULL DEFAULT 0,
  "negative_outcomes" INTEGER NOT NULL DEFAULT 0,
  "computed_weight" DOUBLE PRECISION NOT NULL,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guidance_rule_score_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "guidance_rule_score_rule_id_period_key" ON "guidance_rule_score"("rule_id", "period");
ALTER TABLE "guidance_rule_score" ADD CONSTRAINT "guidance_rule_score_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "guidance_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Staff marks a session or one event good/bad; good ones become cases for Approach B.
CREATE TABLE "guidance_feedback" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "session_id" TEXT,
  "event_id" UUID,
  "rating" TEXT NOT NULL,
  "note" TEXT,
  "staff_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guidance_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guidance_feedback_rating_check" CHECK ("rating" IN ('good', 'bad')),
  CONSTRAINT "guidance_feedback_target_check" CHECK ("session_id" IS NOT NULL OR "event_id" IS NOT NULL)
);
CREATE INDEX "guidance_feedback_proposal_id_idx" ON "guidance_feedback"("proposal_id");
CREATE INDEX "guidance_feedback_event_id_idx" ON "guidance_feedback"("event_id");
CREATE INDEX "guidance_feedback_rating_created_at_idx" ON "guidance_feedback"("rating", "created_at");
ALTER TABLE "guidance_feedback" ADD CONSTRAINT "guidance_feedback_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guidance_feedback" ADD CONSTRAINT "guidance_feedback_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "guidance_session_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guidance_feedback" ADD CONSTRAINT "guidance_feedback_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "guidance_signal_def" ("key", "label", "description", "value_type", "computation_hint", "sort_order") VALUES
  ('completion_delta', 'Completion change', 'Change in completion percent this session (negative means it dropped).', 'percent', 'completion_after - completion at session start', 10),
  ('nodes_reopened', 'Parts reopened', 'Parts moved back to needs_review this session by a change elsewhere.', 'integer', 'count proposal_node transitions into needs_review this session', 20),
  ('turns_without_progress', 'Turns without progress', 'Consecutive agent turns where no part became settled.', 'integer', 'consecutive guidance_session_event rows with completion_after <= completion_before', 30),
  ('unsure_count', 'Unsure parts', 'Parts currently marked unsure (talk to a human).', 'integer', 'count proposal_node where state_code = unsure', 40),
  ('unbounded_flags', 'Unbounded scope flags', 'Open flags saying a part has no clear limits.', 'integer', 'count open unbounded-scope flags on the proposal', 50),
  ('scope_growth_pct', 'Scope growth', 'Percent growth in parts or deliverables this session.', 'percent', '(nodes now - nodes at session start) / nodes at session start * 100', 60),
  ('idle_minutes', 'Idle time', 'Minutes since the client last replied.', 'minutes', 'now - last client message time', 70),
  ('parked_count', 'Saved for later', 'Items parked this session.', 'integer', 'count parked items created this session', 80)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "guidance_move" ("key", "label", "description", "sort_order") VALUES
  ('explain_drop', 'Explain the drop', 'Explain in plain words which change reopened which parts and why the percent went down.', 10),
  ('offer_park', 'Offer to save for later', 'Offer to park the new idea so the current proposal can settle.', 20),
  ('offer_swap', 'Offer a swap', 'Offer to swap the new item for an existing one of similar size.', 30),
  ('ask_priority', 'Ask for priorities', 'Ask the client what matters most, to bound an open-ended part.', 40),
  ('mark_unsure', 'Mark unsure', 'Offer to mark the part unsure so it goes on the call agenda.', 50),
  ('recommend_handoff', 'Recommend a call', 'Recommend a call with Unwhelm and offer to send the proposal as it is.', 60),
  ('offer_tickler', 'Offer a reminder', 'Offer to send a reminder at a time the client picks.', 70),
  ('summarize_progress', 'Summarize progress', 'Recap what is settled and the next best step.', 80)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "guidance_outcome_code" ("code", "label", "description", "polarity", "terminal", "sort_order") VALUES
  ('resolved', 'Resolved', 'The part or question the move addressed got settled.', 1, false, 10),
  ('parked', 'Parked', 'The client saved the item for later.', 1, false, 20),
  ('handoff', 'Handed off', 'The session moved to a call with a human.', 0, true, 30),
  ('submitted', 'Submitted', 'The client submitted the proposal (complete or as is).', 1, true, 40),
  ('abandoned', 'Abandoned', 'The client left and did not come back before expiry.', -1, true, 50),
  ('accepted', 'Accepted', 'The proposal was accepted.', 1, true, 60)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "guidance_rule" ("id", "key", "name", "priority", "base_weight", "trigger", "condition", "suggested_move", "client_phrase", "staff_note") VALUES
  (gen_random_uuid(), 'scope_growth_drop_explain', 'Scope grew and completion dropped: explain', 10, 1.0, 'turn',
    '{"all":[{"signal":"scope_growth_pct","op":">","value":20},{"signal":"completion_delta","op":"<","value":0}]}', 'explain_drop',
    'Adding {item} reopened {parts}, so progress went from {before}% to {after}%.', 'Explain before offering options.'),
  (gen_random_uuid(), 'scope_growth_drop_park', 'Scope grew and completion dropped: offer to park', 20, 0.9, 'turn',
    '{"all":[{"signal":"scope_growth_pct","op":">","value":20},{"signal":"completion_delta","op":"<","value":0}]}', 'offer_park',
    'Want to save {item} for a follow-up so this proposal can settle first?', NULL),
  (gen_random_uuid(), 'reopened_offer_swap', 'Several parts reopened: offer a swap', 30, 0.7, 'node_changed',
    '{"all":[{"signal":"nodes_reopened","op":">=","value":2}]}', 'offer_swap',
    'We could swap {item} for {other} to keep the size about the same.', NULL),
  (gen_random_uuid(), 'stuck_handoff', 'No progress for 6 turns: recommend a call', 5, 1.2, 'turn',
    '{"all":[{"signal":"turns_without_progress","op":">=","value":6}]}', 'recommend_handoff',
    'We have gone back and forth a bit. A quick call with Unwhelm might settle this faster.', 'Matches proposal_handoff_reason stuck.turn_threshold.'),
  (gen_random_uuid(), 'unsure_handoff', 'Two or more unsure parts: recommend a call', 6, 1.1, 'turn',
    '{"all":[{"signal":"unsure_count","op":">=","value":2}]}', 'recommend_handoff',
    'A few parts are easier to settle on a call. You can send it as it is.', NULL),
  (gen_random_uuid(), 'idle_tickler', 'Client idle: offer a reminder', 40, 1.0, 'pause',
    '{"all":[{"signal":"idle_minutes","op":">=","value":15}]}', 'offer_tickler',
    'Want me to remind you to pick this up? Just tell me when.', NULL),
  (gen_random_uuid(), 'unbounded_priority', 'Open-ended scope: ask for priorities', 15, 1.0, 'turn',
    '{"all":[{"signal":"unbounded_flags","op":">=","value":1}]}', 'ask_priority',
    '{part} could grow a lot. What matters most to you there?', NULL),
  (gen_random_uuid(), 'resume_summary', 'Client came back: summarize progress', 50, 0.8, 'resume',
    '{"all":[]}', 'summarize_progress',
    'Welcome back. {settled} of {total} parts are settled; next up is {next}.', NULL)
ON CONFLICT ("key") DO NOTHING;
