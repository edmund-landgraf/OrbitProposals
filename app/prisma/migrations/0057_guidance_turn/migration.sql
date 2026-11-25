-- Live guidance turns. Rule text and weights stay on guidance_rule. These rows only bound
-- how many moves one turn injects, and how long a follow-up tool may stamp an action on that turn.
CREATE TABLE "guidance_setting" (
  "key" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "note" TEXT,
  CONSTRAINT "guidance_setting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "guidance_setting" ("key", "value", "note") VALUES
  ('max_suggested_moves', 3, 'How many ranked moves to inject into one agent turn.'),
  ('action_attach_seconds', 120, 'A follow-up tool stamps action_taken on the latest session event when that event has no action and is newer than this many seconds.')
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "guidance_session_event" ADD COLUMN "session_baseline" JSONB;

INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0002-0000-4000-8000-000000000005', 3, 'unw_list_guidance_events', '{"proposalId":"{proposalId}","limit":5}', '{}', 'ok', 'Guidance turns so far');

INSERT INTO "try_me_exercise_tool" ("exercise_code", "tool_name") VALUES
  ('progress', 'unw_list_guidance_events')
ON CONFLICT DO NOTHING;
