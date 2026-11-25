-- Every /try plan call now succeeds against a fresh sandbox, except the one plan that exists to show refusals.
-- Staff-only and contract-only calls move into "What a client agent can't do", clearly framed as expected refusals.

-- scope_creep: submit first so there is a version, then lock against that real version id so progress moves.
UPDATE "try_me_task_call" SET "seq" = "seq" + 100 WHERE "task_id" = '7d0f0002-0000-4000-8000-000000000004';
UPDATE "try_me_task_call" SET "seq" = 1 WHERE "task_id" = '7d0f0002-0000-4000-8000-000000000004' AND "tool_name" = 'unw_update_proposal_section';
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0002-0000-4000-8000-000000000004', 2, 'unw_submit_proposal_for_review', '{"proposalId":"{proposalId}"}', '{"versionId":"entity.version.id"}', 'ok', 'Submit, which snapshots a version'),
  ('7d0f0002-0000-4000-8000-000000000004', 4, 'unw_get_proposal_progress', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Progress with the scope locked'),
  ('7d0f0002-0000-4000-8000-000000000004', 6, 'unw_lock_node', '{"nodeKey":"scope","versionId":"{versionId}","proposalId":"{proposalId}"}', '{}', 'ok', 'Lock the scope again');
UPDATE "try_me_task_call" SET "seq" = 3, "expect" = 'ok', "arguments" = '{"nodeKey":"scope","versionId":"{versionId}","proposalId":"{proposalId}"}', "note" = 'Lock the scope on that version'
  WHERE "task_id" = '7d0f0002-0000-4000-8000-000000000004' AND "tool_name" = 'unw_lock_node' AND "seq" > 100;
UPDATE "try_me_task_call" SET "seq" = 5, "expect" = 'ok' WHERE "task_id" = '7d0f0002-0000-4000-8000-000000000004' AND "tool_name" = 'unw_unlock_node';
UPDATE "try_me_task_call" SET "seq" = 7 WHERE "task_id" = '7d0f0002-0000-4000-8000-000000000004' AND "tool_name" = 'unw_get_completion_tree';
UPDATE "try_me_task" SET "narration" = 'A clearer title, then the agent submits the draft, which snapshots a version. It locks the scope against that version, so progress moves, shows that unlocking puts it back, and locks it again.'
  WHERE "id" = '7d0f0002-0000-4000-8000-000000000004';
UPDATE "try_me_task_call" c SET "expect" = 'ok' FROM "try_me_task" t WHERE c."task_id" = t."id" AND t."try_me_code" <> 'boundaries' AND c."expect" = 'either';

-- reminders: the client chooses email with consent, so a nudge can be scheduled. Delivery is staff-run, so nothing is sent.
UPDATE "try_me_task_call" SET "arguments" = '{"channel":"email","email":"demo.client@example.com","consent":true,"timezone":"America/Los_Angeles"}', "note" = 'Email, with consent'
  WHERE "task_id" = (SELECT "id" FROM "try_me_task" WHERE "try_me_code" = 'reminders' AND "seq" = 1) AND "tool_name" = 'unw_set_contact_preference';
UPDATE "try_me_task_call" SET "expect" = 'ok', "note" = 'Every 3 days at 9am' WHERE "task_id" = (SELECT "id" FROM "try_me_task" WHERE "try_me_code" = 'reminders' AND "seq" = 3) AND "tool_name" = 'unw_set_tickler' AND "seq" = 1;

-- boundaries: one task per kind of refusal.
INSERT INTO "try_me_task" ("id", "try_me_code", "seq", "title", "narration") VALUES
  ('7d0f00b4-0000-4000-8000-000000000004', 'boundaries', 4, 'Staff billing', 'Invoices, credits and hours are staff work. Each call below is refused, and that refusal is the point.'),
  ('7d0f00b5-0000-4000-8000-000000000005', 'boundaries', 5, 'Needs a contract or staff first', 'These client tools only work once staff approve a proposal or a contract exists. A fresh sandbox has neither, so the server says no, as it should.'),
  ('7d0f00b6-0000-4000-8000-000000000006', 'boundaries', 6, 'Staff reminders', 'Reading reminder queues and sending reminders are staff jobs. The client token cannot do either.');

-- Move a call into a boundaries task as an expected refusal. Contract and proposal ids become the zero id there.
-- Keyed by tool name: call ids are generated per database, so id prefixes never match outside the database they came from.
CREATE TEMP TABLE "try_move" ("tool_name" TEXT, "task_id" UUID, "seq" INTEGER);
INSERT INTO "try_move" VALUES
  ('unw_list_reminders', '7d0f00b6-0000-4000-8000-000000000006', 1),
  ('unw_list_deliveries', '7d0f00b6-0000-4000-8000-000000000006', 2),
  ('unw_run_reminders', '7d0f00b6-0000-4000-8000-000000000006', 3),
  ('unw_deliver_reminders', '7d0f00b6-0000-4000-8000-000000000006', 4),
  ('unw_review_decision', '7d0f0007-0000-4000-8000-000000000003', 101),
  ('unw_resubmit_proposal', '7d0f00b5-0000-4000-8000-000000000005', 2),
  ('unw_extend_proposal_expiry', '7d0f0007-0000-4000-8000-000000000003', 102),
  ('unw_accept_proposal', '7d0f00b5-0000-4000-8000-000000000005', 4),
  ('unw_get_project', '7d0f00b5-0000-4000-8000-000000000005', 5),
  ('unw_sign_contract', '7d0f00b5-0000-4000-8000-000000000005', 6),
  ('unw_set_contract_billing_terms', '7d0f00b5-0000-4000-8000-000000000005', 7),
  ('unw_get_billing_schedule', '7d0f00b5-0000-4000-8000-000000000005', 8),
  ('unw_release_retainage', '7d0f00b5-0000-4000-8000-000000000005', 9),
  ('unw_get_invoice', '7d0f00b5-0000-4000-8000-000000000005', 10),
  ('unw_list_credits', '7d0f0007-0000-4000-8000-000000000003', 103),
  ('unw_list_hours', '7d0f00b5-0000-4000-8000-000000000005', 11),
  ('unw_remaining_hours', '7d0f00b5-0000-4000-8000-000000000005', 12);
UPDATE "try_me_task_call" c SET "task_id" = m."task_id", "seq" = m."seq", "expect" = 'refused', "capture" = '{}',
  "arguments" = replace(c."arguments"::text, '"{proposalId}"', '"{zeroId}"')::jsonb
  FROM "try_move" m JOIN "try_me_task" t ON t."try_me_code" <> 'boundaries' WHERE c."tool_name" = m."tool_name" AND c."task_id" = t."id";
DROP TABLE "try_move";

-- after_sale's staff billing task moves whole into boundaries.
UPDATE "try_me_task_call" SET "task_id" = '7d0f00b4-0000-4000-8000-000000000004', "expect" = 'refused'
  WHERE "task_id" = (SELECT "id" FROM "try_me_task" WHERE "try_me_code" = 'after_sale' AND "seq" = 4);
UPDATE "try_me_task" SET "active" = FALSE WHERE "try_me_code" = 'after_sale' AND "seq" = 4;
UPDATE "try_me_task" SET "active" = FALSE WHERE "try_me_code" = 'reminders' AND "seq" IN (4, 5);

-- review_loop: approval is staff's, so the agent reads where things stand instead.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "expect", "note") VALUES
  ('7d0f0004-0000-4000-8000-000000000003', 1, 'unw_get_proposal_status', '{"proposalId":"{proposalId}"}', 'ok', 'Where the review stands'),
  ('7d0f0004-0000-4000-8000-000000000003', 2, 'unw_list_review_feedback', '{"proposalId":"{proposalId}"}', 'ok', 'Feedback after resolving');
UPDATE "try_me_task" SET "title" = 'Where it stands', "narration" = 'Approving is a staff decision, so the agent reads the review status and the feedback back to the client instead.'
  WHERE "id" = '7d0f0004-0000-4000-8000-000000000003';
UPDATE "try_me_task_call" SET "arguments" = '{"optionIds":[],"proposalId":"{proposalId}"}', "note" = 'Options on offer (none on this draft)' WHERE "task_id" = (SELECT "id" FROM "try_me_task" WHERE "try_me_code" = 'review_loop' AND "seq" = 4) AND "tool_name" = 'unw_select_proposal_options';
UPDATE "try_me_task" SET "title" = 'Expiry and options', "narration" = 'The agent checks when the proposal expires and which add-on options it carries. Extending and accepting need staff, so they live in the boundaries plan.'
  WHERE "id" = '7d0f0004-0000-4000-8000-000000000004';
UPDATE "try_me" SET "description" = 'A submitted proposal goes through comments and flags. The agent shows where the review stands and when the proposal expires.' WHERE "code" = 'review_loop';

-- reminders narrative.
UPDATE "try_me_task" SET "narration" = 'The agent reads the reminder options from the database and records the client''s choice: email, with consent. Delivery is a staff job, so the demo never sends anything.'
  WHERE "id" = '7d0f0003-0000-4000-8000-000000000001';
UPDATE "try_me_task" SET "title" = 'Schedule a nudge, then stop it', "narration" = 'The client asks for a nudge every three days. They chose email, so the server schedules it. Then the agent stops it, which always works.'
  WHERE "id" = '7d0f0003-0000-4000-8000-000000000003';
UPDATE "try_me" SET "description" = 'How the client picks a reminder channel and timing, and how the agent schedules and stops a nudge. Nothing is sent from the demo.' WHERE "code" = 'reminders';

-- after_sale narrative: only what a client can read.
UPDATE "try_me_task" SET "narration" = 'Accepted work shows up as a project. A fresh sandbox has none yet, so the list starts empty.' WHERE "id" = '7d0f0006-0000-4000-8000-000000000001';
UPDATE "try_me_task" SET "title" = 'Payment terms', "narration" = 'The payment terms a contract can use come straight from the database.' WHERE "id" = '7d0f0006-0000-4000-8000-000000000002';
UPDATE "try_me_task" SET "title" = 'Invoices', "narration" = 'Clients can read their invoices. A fresh sandbox has none yet.' WHERE "id" = '7d0f0006-0000-4000-8000-000000000003';
UPDATE "try_me" SET "description" = 'What a client can read once a proposal becomes a contract: projects, payment terms and invoices. Contract-only and staff tools are in the boundaries plan.' WHERE "code" = 'after_sale';

UPDATE "try_me" SET "description" = 'Every admin, catalog, staff and contract-only tool, called with a fresh client token. Every call here is meant to be refused, and the refusal is the lesson.' WHERE "code" = 'boundaries';
UPDATE "try_me_task" SET "narration" = 'The follow-up queue, agent traces, review decisions, expiry extensions and credits are staff views. A client token is refused.' WHERE "id" = '7d0f0007-0000-4000-8000-000000000003';

-- The tickler repeats every three days, as the narration says.
UPDATE "try_me_task_call" SET "arguments" = "arguments" || '{"option":"every_n_days"}' WHERE "task_id" = (SELECT "id" FROM "try_me_task" WHERE "try_me_code" = 'reminders' AND "seq" = 3) AND "tool_name" = 'unw_set_tickler' AND "seq" = 1;
