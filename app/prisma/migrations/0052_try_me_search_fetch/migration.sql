-- Connector search and fetch tools (ChatGPT/Claude): the scope plan finds its proposal and reads it back by id.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0002-0000-4000-8000-000000000004', 8, 'search', '{"query":""}', '{}', 'ok', 'Connector search lists what this token can see'),
  ('7d0f0002-0000-4000-8000-000000000004', 9, 'fetch', '{"id":"proposal:{proposalId}"}', '{}', 'ok', 'Connector fetch reads the proposal back by id');
