-- PR B: guided public "Try me" demo, driven entirely by rows.
-- try_me (one plan, one dropdown entry) 1..n try_me_task (ordered; the visitor may stop after any task)
-- 1..n try_me_task_call (ordered MCP tool calls with argument templates and an expected outcome).
-- Taken together, the active plans call every unwh-mcp tool; tests/api/demo.test.ts fails when one is missing.
-- Each run records try_me_session and one try_me_session_call per call, linked to its agent_trace row.
CREATE TABLE "try_me_setting" (
  "code" TEXT PRIMARY KEY,
  "value" INTEGER NOT NULL,
  "note" TEXT
);
INSERT INTO "try_me_setting" ("code", "value", "note") VALUES
  ('enabled', 1, '1 lets the public start demos; 0 turns Try me off'),
  ('ttl_minutes', 30, 'how long a sandbox org, user, token, and proposals live before cleanup, including after a takeover'),
  ('max_starts_per_ip_per_hour', 3, 'demo starts allowed per visitor IP hash in a rolling hour'),
  ('max_active_sessions', 25, 'unexpired demo sessions allowed at once across all visitors'),
  ('step_delay_ms', 700, 'pause between tool calls so a visitor can watch the run unfold');

CREATE TABLE "try_me" (
  "code" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sort" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE "try_me_task" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "try_me_code" TEXT NOT NULL REFERENCES "try_me"("code") ON DELETE CASCADE,
  "seq" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "narration" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "try_me_task_plan_seq_key" UNIQUE ("try_me_code", "seq")
);

-- expect: ok (must succeed), refused (must be refused, e.g. a staff tool with a client token), either (shown as is).
CREATE TABLE "try_me_task_call" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL REFERENCES "try_me_task"("id") ON DELETE CASCADE,
  "seq" INTEGER NOT NULL,
  "tool_name" TEXT NOT NULL,
  "arguments" JSONB NOT NULL DEFAULT '{}',
  "capture" JSONB NOT NULL DEFAULT '{}',
  "expect" TEXT NOT NULL DEFAULT 'ok' CHECK ("expect" IN ('ok', 'refused', 'either')),
  "note" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "try_me_task_call_task_seq_key" UNIQUE ("task_id", "seq")
);

-- status: running, paused (waiting for the visitor after a task), complete, taken_over, failed.
CREATE TABLE "try_me_session" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "try_me_code" TEXT NOT NULL REFERENCES "try_me"("code"),
  "status" TEXT NOT NULL DEFAULT 'running',
  "next_task_seq" INTEGER,
  "vars" JSONB NOT NULL DEFAULT '{}',
  "ip_hash" TEXT NOT NULL,
  "organization_id" UUID,
  "user_id" UUID,
  "mcp_client_id" UUID,
  "token_id" UUID,
  "proposal_id" UUID,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "purged_at" TIMESTAMPTZ
);
CREATE INDEX "try_me_session_ip_created_idx" ON "try_me_session" ("ip_hash", "created_at");
CREATE INDEX "try_me_session_expires_idx" ON "try_me_session" ("expires_at") WHERE "purged_at" IS NULL;

-- status: pending, running, ok, refused (expected refusal), error, unexpected (succeeded when it should be refused), skipped.
CREATE TABLE "try_me_session_call" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" UUID NOT NULL REFERENCES "try_me_session"("id") ON DELETE CASCADE,
  "task_id" UUID NOT NULL REFERENCES "try_me_task"("id"),
  "call_id" UUID NOT NULL REFERENCES "try_me_task_call"("id"),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "summary" TEXT,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "agent_trace_id" UUID,
  CONSTRAINT "try_me_session_call_key" UNIQUE ("session_id", "call_id")
);

INSERT INTO "try_me" ("code","title","description","sort") VALUES
 ('build_submit', 'Build and submit a proposal', 'An agent drafts a small fixed-price integration proposal, hands hours, milestones, and terms to staff, looks it over, and submits it for review.', 10),
 ('scope_creep', 'Scope creep, handled gently', 'A client keeps adding to a small project. The agent shows what each addition would cost in progress, parks ideas for later, and offers a fresh start or a human.', 20),
 ('reminders', 'Reminders and ticklers', 'How the client picks a reminder channel and timing, and how the agent schedules and stops nudges. Nothing is ever sent from the demo.', 30),
 ('review_loop', 'Review, comments, and acceptance', 'A submitted proposal goes through comments and flags. The agent shows which steps are the client''s and which belong to staff.', 40),
 ('consult_chat', 'Free consult and chat', 'The client books a free consult and talks to the proposal agent in a chat session.', 50),
 ('after_sale', 'After the sale: contracts and billing', 'What a client can read and do once a proposal becomes a contract. The sandbox has no contract, so most calls show the not-found and permission answers an agent should handle.', 60),
 ('boundaries', 'What a client agent can''t do', 'Every admin, catalog, and staff tool, called with a client token, to show the server refusing each one.', 70);

INSERT INTO "try_me_task" ("id","try_me_code","seq","title","narration") VALUES
 ('7d0f0001-0000-4000-8000-000000000001', 'build_submit', 1, 'Get oriented', 'The agent asks the MCP server what it is and what it may do, then reads the engagement types and pricing models from the database, so it never invents an offer.'),
 ('7d0f0001-0000-4000-8000-000000000002', 'build_submit', 2, 'Ask about reminders', 'Intake starts by asking how the client wants reminders. The demo picks none, so nothing is ever sent.'),
 ('7d0f0001-0000-4000-8000-000000000003', 'build_submit', 3, 'Draft the proposal', 'It turns the conversation into a structured draft (scope, deliverables, assumptions, exclusions, timeline, and the client''s stated budget), then checks progress. A proposal is a tree of parts, so progress reads as parts settled out of the total.'),
 ('7d0f0001-0000-4000-8000-000000000004', 'build_submit', 4, 'Hand off what is not the agent''s call', 'Hours and billing milestones are set by a person, and the client is unsure about terms, so each part is handed off instead of guessed. Handing off settles a part, so the count goes up.'),
 ('7d0f0001-0000-4000-8000-000000000005', 'build_submit', 5, 'Look it over', 'Before submitting, the agent reads the draft back the way a client would: the list, the full proposal, its sections, the completion tree, and an export.'),
 ('7d0f0001-0000-4000-8000-000000000006', 'build_submit', 6, 'Submit and confirm', 'The draft goes to agent review and then to Unwhelm staff, and the agent reads the status back so the client hears exactly where things stand.'),
 ('7d0f0002-0000-4000-8000-000000000001', 'scope_creep', 1, 'Start small', 'A tight draft first, and a look at progress.'),
 ('7d0f0002-0000-4000-8000-000000000002', 'scope_creep', 2, 'The client asks for more', 'Before changing anything, the agent previews what the addition would undo, so the client sees why progress would drop.'),
 ('7d0f0002-0000-4000-8000-000000000003', 'scope_creep', 3, 'Park it for later', 'Instead of growing this proposal, the idea is parked as a change and as a note for a follow-up project.'),
 ('7d0f0002-0000-4000-8000-000000000004', 'scope_creep', 4, 'Tighten the draft', 'A clearer title, then lock and unlock a settled part so later edits can''t quietly reopen it.'),
 ('7d0f0002-0000-4000-8000-000000000005', 'scope_creep', 5, 'Fresh start or a human', 'When the shape stops working, the agent can copy the draft into a new one, or recommend a person.'),
 ('7d0f0003-0000-4000-8000-000000000001', 'reminders', 1, 'Pick a channel', 'The agent reads the reminder options from the database and records the client''s choice. The demo picks none.'),
 ('7d0f0003-0000-4000-8000-000000000002', 'reminders', 2, 'Start a draft', 'Reminders are tied to an unfinished proposal.'),
 ('7d0f0003-0000-4000-8000-000000000003', 'reminders', 3, 'Ticklers follow the client''s choice', 'The client asks for a nudge every three days, but they chose no reminders, so the server refuses to schedule one. Stopping a tickler always works. Listing scheduled reminders is a staff view.'),
 ('7d0f0003-0000-4000-8000-000000000004', 'reminders', 4, 'Delivery log', 'The delivery log is a staff view too, so a client token is refused.'),
 ('7d0f0003-0000-4000-8000-000000000005', 'reminders', 5, 'Staff only', 'Running and delivering reminders is a staff job, so a client token is refused.'),
 ('7d0f0004-0000-4000-8000-000000000001', 'review_loop', 1, 'Draft and submit', 'A draft goes straight to review.'),
 ('7d0f0004-0000-4000-8000-000000000002', 'review_loop', 2, 'Comment and flag', 'The client asks a question, reads the feedback, resolves it, and flags a concern.'),
 ('7d0f0004-0000-4000-8000-000000000003', 'review_loop', 3, 'Decisions are staff''s', 'Approving is a staff decision, so a client token gets a clear no. Resubmitting depends on the review state.'),
 ('7d0f0004-0000-4000-8000-000000000004', 'review_loop', 4, 'Expiry, options, acceptance', 'Proposals expire and only staff extend them. Options get picked, and acceptance only works once staff approve.'),
 ('7d0f0005-0000-4000-8000-000000000001', 'consult_chat', 1, 'Free consult', 'Offerings come from the database. The request lands in the staff intake queue.'),
 ('7d0f0005-0000-4000-8000-000000000002', 'consult_chat', 2, 'Chat with the proposal agent', 'A chat session holds the conversation behind a proposal.'),
 ('7d0f0006-0000-4000-8000-000000000001', 'after_sale', 1, 'Projects', 'Accepted work shows up as a project.'),
 ('7d0f0006-0000-4000-8000-000000000002', 'after_sale', 2, 'Contract', 'Payment terms come from the database. Signing needs a real contract, and setting terms or releasing retainage is staff work.'),
 ('7d0f0006-0000-4000-8000-000000000003', 'after_sale', 3, 'Invoices and hours', 'Clients can read invoices and hours. Credits are a staff view.'),
 ('7d0f0006-0000-4000-8000-000000000004', 'after_sale', 4, 'Staff billing', 'Logging hours and writing invoices is staff work, so a client token is refused.'),
 ('7d0f0007-0000-4000-8000-000000000001', 'boundaries', 1, 'Admin tools', 'Users, orgs, tokens, and deletes are admin only.'),
 ('7d0f0007-0000-4000-8000-000000000002', 'boundaries', 2, 'Catalog tools', 'Prices and billing rules are staff-edited rows.'),
 ('7d0f0007-0000-4000-8000-000000000003', 'boundaries', 3, 'Staff queues', 'The follow-up queue and agent traces are staff views.');

INSERT INTO "try_me_task_call" ("task_id","seq","tool_name","arguments","capture","expect","note") VALUES
 ('7d0f0001-0000-4000-8000-000000000001', 1, 'unw_get_service_info', '{}', '{}', 'ok', 'What is this server?'),
 ('7d0f0001-0000-4000-8000-000000000001', 2, 'unw_get_catalog', '{}', '{}', 'ok', 'Engagement types and pricing models'),
 ('7d0f0001-0000-4000-8000-000000000002', 1, 'unw_set_contact_preference', '{"channel":"none","consent":false,"timezone":"America/Los_Angeles"}', '{}', 'ok', 'No reminders for a demo'),
 ('7d0f0001-0000-4000-8000-000000000003', 1, 'unw_create_proposal', '{"title":"Try me: rental listing sync","engagement":"fixed_price","scope":{"summary":"Sync rental listings from a property management system to a public listings site every hour.","deliverables":["Hourly listing sync job","Field mapping document","Error report email"],"assumptions":["The client provides API credentials for both systems"],"exclusions":["Changes to either vendor system"]},"timeline":{"startDate":"2026-11-02","targetDate":"2026-11-30"},"pricing":{"model":"fixed_price","amountMinor":300000,"currency":"USD"}}', '{"proposalId":"entity.id"}', 'ok', 'Create the draft'),
 ('7d0f0001-0000-4000-8000-000000000003', 2, 'unw_get_proposal_progress', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Progress at the start'),
 ('7d0f0001-0000-4000-8000-000000000004', 1, 'unw_mark_part_unsure', '{"proposalId":"{proposalId}","nodeKey":"hours","resolution":"staff_decides","note":"The agent never estimates hours."}', '{}', 'ok', 'Hours: staff decides'),
 ('7d0f0001-0000-4000-8000-000000000004', 2, 'unw_mark_part_unsure', '{"proposalId":"{proposalId}","nodeKey":"milestones","resolution":"staff_decides","note":"Staff will set billing milestones."}', '{}', 'ok', 'Milestones: staff decides'),
 ('7d0f0001-0000-4000-8000-000000000004', 3, 'unw_mark_part_unsure', '{"proposalId":"{proposalId}","nodeKey":"terms","resolution":"unsure","note":"Client wants to talk terms with a human."}', '{}', 'ok', 'Terms: client unsure'),
 ('7d0f0001-0000-4000-8000-000000000004', 4, 'unw_get_proposal_progress', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Progress after handing off'),
 ('7d0f0001-0000-4000-8000-000000000005', 1, 'unw_list_proposals', '{"limit":5}', '{}', 'ok', 'Your proposals'),
 ('7d0f0001-0000-4000-8000-000000000005', 2, 'unw_get_proposal', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'The full draft'),
 ('7d0f0001-0000-4000-8000-000000000005', 3, 'unw_list_proposal_sections', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Its sections'),
 ('7d0f0001-0000-4000-8000-000000000005', 4, 'unw_get_completion_tree', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Every part and its state'),
 ('7d0f0001-0000-4000-8000-000000000005', 5, 'unw_export_proposal', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Export it'),
 ('7d0f0001-0000-4000-8000-000000000006', 1, 'unw_submit_proposal_for_review', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Submit for review'),
 ('7d0f0001-0000-4000-8000-000000000006', 2, 'unw_get_proposal_status', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Read the status back'),
 ('7d0f0002-0000-4000-8000-000000000001', 1, 'unw_create_proposal', '{"title":"Try me: listing sync, small","engagement":"fixed_price","scope":{"summary":"Sync rental listings from a property management system to a public listings site every hour.","deliverables":["Hourly listing sync job","Field mapping document","Error report email"],"assumptions":["The client provides API credentials for both systems"],"exclusions":["Changes to either vendor system"]},"timeline":{"startDate":"2026-11-02","targetDate":"2026-11-30"},"pricing":{"model":"fixed_price","amountMinor":300000,"currency":"USD"}}', '{"proposalId":"entity.id"}', 'ok', 'Create the draft'),
 ('7d0f0002-0000-4000-8000-000000000001', 2, 'unw_get_proposal_progress', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Where we start'),
 ('7d0f0002-0000-4000-8000-000000000002', 1, 'unw_preview_change_impact', '{"proposalId":"{proposalId}","nodeKey":"scope","change":"Also sync guest reviews and photos from a second listings site."}', '{}', 'either', 'What would this change undo?'),
 ('7d0f0002-0000-4000-8000-000000000002', 2, 'unw_get_proposal_progress', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Progress is unchanged until they decide'),
 ('7d0f0002-0000-4000-8000-000000000003', 1, 'unw_park_change', '{"proposalId":"{proposalId}","nodeKey":"scope","change":"Sync guest reviews and photos too.","mode":"phase_2"}', '{}', 'ok', 'Park the change'),
 ('7d0f0002-0000-4000-8000-000000000003', 2, 'unw_park_item', '{"proposalId":"{proposalId}","summary":"Phase 2 idea: reviews and photos sync."}', '{}', 'ok', 'Park a note'),
 ('7d0f0002-0000-4000-8000-000000000003', 3, 'unw_list_parked', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'What is parked'),
 ('7d0f0002-0000-4000-8000-000000000004', 1, 'unw_update_proposal_section', '{"proposalId":"{proposalId}","sectionId":"title","value":"Try me: hourly listing sync (phase 1)"}', '{}', 'ok', 'Rename it'),
 ('7d0f0002-0000-4000-8000-000000000004', 2, 'unw_lock_node', '{"proposalId":"{proposalId}","nodeKey":"scope","versionId":"{zeroId}"}', '{}', 'either', 'Lock the scope (needs a real version id)'),
 ('7d0f0002-0000-4000-8000-000000000004', 3, 'unw_unlock_node', '{"proposalId":"{proposalId}","nodeKey":"scope"}', '{}', 'either', 'Unlock it'),
 ('7d0f0002-0000-4000-8000-000000000004', 4, 'unw_get_completion_tree', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'The tree now'),
 ('7d0f0002-0000-4000-8000-000000000005', 1, 'unw_duplicate_proposal', '{"proposalId":"{proposalId}","title":"Try me: listing sync, phase 2","reason":"Split the extra scope into its own proposal."}', '{}', 'ok', 'Copy into a phase 2 draft'),
 ('7d0f0002-0000-4000-8000-000000000005', 2, 'unw_recommend_handoff', '{"proposalId":"{proposalId}","reasonCode":"scope_unbounded","note":"Client keeps widening scope; a human should help shape it."}', '{}', 'ok', 'Recommend a human'),
 ('7d0f0003-0000-4000-8000-000000000001', 1, 'unw_get_reminder_options', '{}', '{}', 'ok', 'Channels and timings on offer'),
 ('7d0f0003-0000-4000-8000-000000000001', 2, 'unw_set_contact_preference', '{"channel":"none","consent":false,"timezone":"America/Los_Angeles"}', '{}', 'ok', 'No reminders for a demo'),
 ('7d0f0003-0000-4000-8000-000000000002', 1, 'unw_create_proposal', '{"title":"Try me: tickler demo","engagement":"fixed_price","scope":{"summary":"Sync rental listings from a property management system to a public listings site every hour.","deliverables":["Hourly listing sync job","Field mapping document","Error report email"],"assumptions":["The client provides API credentials for both systems"],"exclusions":["Changes to either vendor system"]},"timeline":{"startDate":"2026-11-02","targetDate":"2026-11-30"},"pricing":{"model":"fixed_price","amountMinor":300000,"currency":"USD"}}', '{"proposalId":"entity.id"}', 'ok', 'Create the draft'),
 ('7d0f0003-0000-4000-8000-000000000003', 1, 'unw_set_tickler', '{"proposalId":"{proposalId}","intervalDays":3,"timeOfDay":"09:00"}', '{}', 'refused', 'Every 3 days at 9am (refused: reminders are off)'),
 ('7d0f0003-0000-4000-8000-000000000003', 2, 'unw_list_reminders', '{"proposalId":"{proposalId}"}', '{}', 'refused', 'Scheduled reminders (staff view)'),
 ('7d0f0003-0000-4000-8000-000000000003', 3, 'unw_set_tickler', '{"proposalId":"{proposalId}","stop":true}', '{}', 'ok', 'Stop the tickler'),
 ('7d0f0003-0000-4000-8000-000000000004', 1, 'unw_list_deliveries', '{"proposalId":"{proposalId}"}', '{}', 'refused', 'Deliveries (staff view)'),
 ('7d0f0003-0000-4000-8000-000000000005', 1, 'unw_run_reminders', '{"dryRun":true}', '{}', 'refused', 'Run reminders (staff)'),
 ('7d0f0003-0000-4000-8000-000000000005', 2, 'unw_deliver_reminders', '{}', '{}', 'refused', 'Deliver reminders (staff)'),
 ('7d0f0004-0000-4000-8000-000000000001', 1, 'unw_create_proposal', '{"title":"Try me: review demo","engagement":"fixed_price","scope":{"summary":"Sync rental listings from a property management system to a public listings site every hour.","deliverables":["Hourly listing sync job","Field mapping document","Error report email"],"assumptions":["The client provides API credentials for both systems"],"exclusions":["Changes to either vendor system"]},"timeline":{"startDate":"2026-11-02","targetDate":"2026-11-30"},"pricing":{"model":"fixed_price","amountMinor":300000,"currency":"USD"}}', '{"proposalId":"entity.id"}', 'ok', 'Create the draft'),
 ('7d0f0004-0000-4000-8000-000000000001', 2, 'unw_submit_proposal_for_review', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'Submit'),
 ('7d0f0004-0000-4000-8000-000000000002', 1, 'unw_add_review_comment', '{"proposalId":"{proposalId}","body":"Does the hourly sync include deleted listings?","type":"question","visibility":"client","targetKind":"proposal"}', '{"commentId":"entity.id"}', 'either', 'Ask a question'),
 ('7d0f0004-0000-4000-8000-000000000002', 2, 'unw_list_review_feedback', '{"proposalId":"{proposalId}"}', '{}', 'ok', 'All feedback'),
 ('7d0f0004-0000-4000-8000-000000000002', 3, 'unw_resolve_review_comment', '{"proposalId":"{proposalId}","commentId":"{commentId}"}', '{}', 'either', 'Resolve it'),
 ('7d0f0004-0000-4000-8000-000000000002', 4, 'unw_add_review_flag', '{"proposalId":"{proposalId}","reason":"Client wants a second look at timeline.","visibility":"client","targetKind":"proposal"}', '{}', 'either', 'Flag a concern'),
 ('7d0f0004-0000-4000-8000-000000000003', 1, 'unw_review_decision', '{"proposalId":"{proposalId}","decision":"approve"}', '{}', 'either', 'Try to approve (staff only)'),
 ('7d0f0004-0000-4000-8000-000000000003', 2, 'unw_resubmit_proposal', '{"proposalId":"{proposalId}"}', '{}', 'either', 'Resubmit'),
 ('7d0f0004-0000-4000-8000-000000000004', 1, 'unw_get_proposal_expiry', '{"proposalId":"{proposalId}"}', '{}', 'either', 'When does it expire?'),
 ('7d0f0004-0000-4000-8000-000000000004', 2, 'unw_extend_proposal_expiry', '{"proposalId":"{proposalId}","days":7,"reason":"Client needs another week."}', '{}', 'refused', 'Extend it a week (staff only)'),
 ('7d0f0004-0000-4000-8000-000000000004', 3, 'unw_select_proposal_options', '{"proposalId":"{proposalId}","optionIds":["{zeroId}"]}', '{}', 'either', 'Pick an option (none exist yet)'),
 ('7d0f0004-0000-4000-8000-000000000004', 4, 'unw_accept_proposal', '{"proposalId":"{proposalId}"}', '{}', 'either', 'Try to accept before approval'),
 ('7d0f0005-0000-4000-8000-000000000001', 1, 'unw_list_consult_offerings', '{}', '{}', 'ok', 'What''s on offer'),
 ('7d0f0005-0000-4000-8000-000000000001', 2, 'unw_request_free_consult', '{"topic":"Try me: listing sync questions","details":"Demo request; safe to ignore."}', '{}', 'ok', 'Request a consult'),
 ('7d0f0005-0000-4000-8000-000000000001', 3, 'unw_list_consult_intakes', '{}', '{}', 'ok', 'My consult requests'),
 ('7d0f0005-0000-4000-8000-000000000002', 1, 'unw_create_chat_session', '{"agent":"proposal"}', '{"sessionId":"entity.id"}', 'ok', 'Open a chat'),
 ('7d0f0005-0000-4000-8000-000000000002', 2, 'unw_send_chat_message', '{"sessionId":"{sessionId}","content":"Hi, I want to sync rental listings to my website every hour."}', '{}', 'either', 'Say hello'),
 ('7d0f0005-0000-4000-8000-000000000002', 3, 'unw_list_chat_messages', '{"sessionId":"{sessionId}"}', '{}', 'ok', 'The conversation'),
 ('7d0f0005-0000-4000-8000-000000000002', 4, 'unw_list_chat_sessions', '{"limit":5}', '{}', 'ok', 'My chats'),
 ('7d0f0006-0000-4000-8000-000000000001', 1, 'unw_list_projects', '{"limit":5}', '{}', 'ok', 'My projects'),
 ('7d0f0006-0000-4000-8000-000000000001', 2, 'unw_get_project', '{"projectId":"{zeroId}"}', '{}', 'either', 'Open one that doesn''t exist'),
 ('7d0f0006-0000-4000-8000-000000000002', 1, 'unw_list_payment_terms', '{}', '{}', 'ok', 'Payment terms on offer'),
 ('7d0f0006-0000-4000-8000-000000000002', 2, 'unw_sign_contract', '{"contractId":"{zeroId}"}', '{}', 'either', 'Sign'),
 ('7d0f0006-0000-4000-8000-000000000002', 3, 'unw_set_contract_billing_terms', '{"contractId":"{zeroId}"}', '{}', 'refused', 'Choose terms (staff only)'),
 ('7d0f0006-0000-4000-8000-000000000002', 4, 'unw_get_billing_schedule', '{"contractId":"{zeroId}"}', '{}', 'either', 'Billing schedule'),
 ('7d0f0006-0000-4000-8000-000000000002', 5, 'unw_release_retainage', '{"contractId":"{zeroId}"}', '{}', 'refused', 'Release retainage (staff only)'),
 ('7d0f0006-0000-4000-8000-000000000003', 1, 'unw_list_invoices', '{"limit":5}', '{}', 'ok', 'My invoices'),
 ('7d0f0006-0000-4000-8000-000000000003', 2, 'unw_get_invoice', '{"invoiceId":"{zeroId}"}', '{}', 'either', 'Open one'),
 ('7d0f0006-0000-4000-8000-000000000003', 3, 'unw_list_credits', '{}', '{}', 'refused', 'Credits (staff view)'),
 ('7d0f0006-0000-4000-8000-000000000003', 4, 'unw_list_hours', '{"contractId":"{zeroId}"}', '{}', 'either', 'Hours logged'),
 ('7d0f0006-0000-4000-8000-000000000003', 5, 'unw_remaining_hours', '{"contractId":"{zeroId}"}', '{}', 'either', 'Hours left'),
 ('7d0f0006-0000-4000-8000-000000000004', 1, 'unw_log_hours', '{"contractId":"{zeroId}","date":"2026-11-03","hours":1,"description":"Demo"}', '{}', 'refused', 'Log hours'),
 ('7d0f0006-0000-4000-8000-000000000004', 2, 'unw_create_invoice', '{"contractId":"{zeroId}","amount":100,"dueDate":"2026-12-01"}', '{}', 'refused', 'Create an invoice'),
 ('7d0f0006-0000-4000-8000-000000000004', 3, 'unw_send_invoice', '{"invoiceId":"{zeroId}"}', '{}', 'refused', 'Send it'),
 ('7d0f0006-0000-4000-8000-000000000004', 4, 'unw_pay_invoice', '{"invoiceId":"{zeroId}"}', '{}', 'refused', 'Mark paid'),
 ('7d0f0006-0000-4000-8000-000000000004', 5, 'unw_void_invoice', '{"invoiceId":"{zeroId}"}', '{}', 'refused', 'Void it'),
 ('7d0f0006-0000-4000-8000-000000000004', 6, 'unw_invoice_hours', '{"contractId":"{zeroId}","from":"2026-11-01","to":"2026-11-30"}', '{}', 'refused', 'Invoice hours'),
 ('7d0f0006-0000-4000-8000-000000000004', 7, 'unw_apply_credit', '{"creditId":"{zeroId}","invoiceId":"{zeroId}"}', '{}', 'refused', 'Apply a credit'),
 ('7d0f0007-0000-4000-8000-000000000001', 1, 'unw_admin_list_users', '{}', '{}', 'refused', 'List users'),
 ('7d0f0007-0000-4000-8000-000000000001', 2, 'unw_admin_create_user', '{"email":"nobody@demo.unwhelm.invalid","name":"Nobody"}', '{}', 'refused', 'Create a user'),
 ('7d0f0007-0000-4000-8000-000000000001', 3, 'unw_admin_list_orgs', '{}', '{}', 'refused', 'List orgs'),
 ('7d0f0007-0000-4000-8000-000000000001', 4, 'unw_admin_create_org', '{"name":"Nope"}', '{}', 'refused', 'Create an org'),
 ('7d0f0007-0000-4000-8000-000000000001', 5, 'unw_admin_add_org_member', '{"orgId":"{zeroId}","userId":"{zeroId}"}', '{}', 'refused', 'Add a member'),
 ('7d0f0007-0000-4000-8000-000000000001', 6, 'unw_admin_list_scope_presets', '{}', '{}', 'refused', 'Scope presets'),
 ('7d0f0007-0000-4000-8000-000000000001', 7, 'unw_admin_mint_magic_link', '{"userId":"{zeroId}"}', '{}', 'refused', 'Mint a magic link'),
 ('7d0f0007-0000-4000-8000-000000000001', 8, 'unw_admin_list_tokens', '{}', '{}', 'refused', 'List tokens'),
 ('7d0f0007-0000-4000-8000-000000000001', 9, 'unw_admin_mint_token', '{"userId":"{zeroId}","name":"nope"}', '{}', 'refused', 'Mint a token'),
 ('7d0f0007-0000-4000-8000-000000000001', 10, 'unw_admin_revoke_token', '{"tokenId":"{zeroId}"}', '{}', 'refused', 'Revoke a token'),
 ('7d0f0007-0000-4000-8000-000000000001', 11, 'unw_admin_delete_proposal', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'Delete a proposal'),
 ('7d0f0007-0000-4000-8000-000000000002', 1, 'unw_get_catalog_draft', '{}', '{}', 'refused', 'Read the draft catalog'),
 ('7d0f0007-0000-4000-8000-000000000002', 2, 'unw_create_catalog_draft', '{}', '{}', 'refused', 'Start a draft'),
 ('7d0f0007-0000-4000-8000-000000000002', 3, 'unw_update_price_tier', '{"versionId":"{zeroId}","code":"x","amountMinor":1}', '{}', 'refused', 'Change a price'),
 ('7d0f0007-0000-4000-8000-000000000002', 4, 'unw_update_billing_schedule_line', '{"versionId":"{zeroId}","lineId":"{zeroId}","label":"x"}', '{}', 'refused', 'Change a billing line'),
 ('7d0f0007-0000-4000-8000-000000000002', 5, 'unw_update_invoice_policy', '{"versionId":"{zeroId}","invoiceOnSign":true}', '{}', 'refused', 'Change invoice policy'),
 ('7d0f0007-0000-4000-8000-000000000002', 6, 'unw_publish_catalog', '{"versionId":"{zeroId}"}', '{}', 'refused', 'Publish'),
 ('7d0f0007-0000-4000-8000-000000000003', 1, 'unw_list_follow_up_queue', '{"limit":5}', '{}', 'refused', 'Follow-up queue'),
 ('7d0f0007-0000-4000-8000-000000000003', 2, 'unw_list_agent_traces', '{"limit":5}', '{}', 'refused', 'Agent traces');
