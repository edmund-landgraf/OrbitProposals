-- Review lifecycle fixes (MCP proposal sweep).
-- 1. Changes requested is a state the client is meant to edit in: scope, price, timeline, and narrative parts open up,
--    and the client (or the agent on the client's behalf) can resubmit directly or start a revision first.
-- 2. The agent can start a revision and withdraw on the client's behalf, mirroring the client rows.
-- Numbered 0063 so it does not collide with 0061/0062 in the open agreed-state PR.

UPDATE "proposal_review_status" SET "client_editable" = true WHERE "code" = 'changes_requested';

INSERT INTO "proposal_review_transition" (
  "id", "from_status", "to_status", "actor_role", "action", "label",
  "requires_reason", "requires_comment", "snapshots", "locks_version", "clears_approved_version", "blocked_by_open_flags", "runs_unbounded_check"
) VALUES
  ('20000000-0000-4000-8000-000000000031', 'changes_requested', 'client_revising', 'agent', 'start_revision', 'Start revision', false, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000032', 'changes_requested', 'resubmitted', 'client', 'resubmit', 'Resubmit', false, false, true, false, false, false, false),
  ('20000000-0000-4000-8000-000000000033', 'changes_requested', 'resubmitted', 'agent', 'resubmit', 'Resubmit', false, false, true, false, false, false, false),
  ('20000000-0000-4000-8000-000000000034', 'draft', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000035', 'agent_review', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000036', 'in_review', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000037', 'changes_requested', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000038', 'client_revising', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000039', 'resubmitted', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000040', 'review_meeting_scheduled', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false),
  ('20000000-0000-4000-8000-000000000041', 'approved', 'withdrawn', 'agent', 'withdraw', 'Withdraw', true, false, false, false, false, false, false)
ON CONFLICT DO NOTHING;

-- Every registered MCP tool must appear in a Try me plan call. A fresh sandbox has no approval, no requested changes,
-- and no flag id to resolve, so these calls use the zero id and are expected refusals, like the other staff-first calls.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0007-0000-4000-8000-000000000003', 104, 'unw_start_staff_review', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'Start staff review (staff only)'),
  ('7d0f00b5-0000-4000-8000-000000000005', 13, 'unw_reopen_proposal', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'Reopen an approved proposal (needs an approval)'),
  ('7d0f00b5-0000-4000-8000-000000000005', 14, 'unw_start_revision', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'Start a revision (needs staff to request changes)'),
  ('7d0f00b5-0000-4000-8000-000000000005', 15, 'unw_resolve_review_flag', '{"proposalId":"{zeroId}","flagId":"{zeroId}"}', '{}', 'refused', 'Resolve a review flag (needs a flag)'),
  ('7d0f00b5-0000-4000-8000-000000000005', 16, 'unw_withdraw_proposal', '{"proposalId":"{zeroId}","reasonCode":"timing"}', '{}', 'refused', 'Withdraw (shown on the zero id so the sandbox proposal stays open)')
ON CONFLICT DO NOTHING;

INSERT INTO "try_me_exercise_tool" ("exercise_code", "tool_name") VALUES
  ('review', 'unw_resolve_review_flag'),
  ('review', 'unw_start_revision'),
  ('review', 'unw_reopen_proposal'),
  ('review', 'unw_withdraw_proposal')
ON CONFLICT DO NOTHING;
