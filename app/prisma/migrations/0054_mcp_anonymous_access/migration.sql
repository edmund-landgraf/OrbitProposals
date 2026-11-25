-- Anonymous MCP access (ChatGPT app): limits for callers without a token.
INSERT INTO mcp_client_setting (key, value) VALUES
  ('anonymous_rate_limit', 30),
  ('anonymous_rate_window_seconds', 600)
ON CONFLICT (key) DO NOTHING;

-- Try me: build a draft without saving it.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0002-0000-4000-8000-000000000004', 10, 'unw_draft_proposal', '{"title":"Try me: anonymous draft","engagement":"fixed_price","scope":{"summary":"Sync rental listings from a property management system to a public listings site every hour.","deliverables":["Hourly listing sync job"]}}', '{}', 'ok', 'Draft a proposal without saving it');
