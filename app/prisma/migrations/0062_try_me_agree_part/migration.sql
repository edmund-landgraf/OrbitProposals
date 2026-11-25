-- Every registered MCP tool must appear in a Try me plan call. unw_agree_part is the
-- client action that settles a drafted part, so the build-and-submit plan agrees scope
-- after the draft is written, and the progress exercise lists the tool.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0001-0000-4000-8000-000000000003', 10, 'unw_agree_part', '{"proposalId":"{proposalId}","nodeKey":"scope"}', '{}', 'ok', 'Client agrees the drafted scope');

INSERT INTO "try_me_exercise_tool" ("exercise_code", "tool_name") VALUES
  ('progress', 'unw_agree_part')
ON CONFLICT DO NOTHING;
