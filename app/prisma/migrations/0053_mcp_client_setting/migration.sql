CREATE TABLE IF NOT EXISTS mcp_client_setting (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO mcp_client_setting (key, value) VALUES ('unused_client_ttl_days', 7) ON CONFLICT (key) DO NOTHING;

-- Try me: client tokens are refused the staff client-cleanup tools.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0007-0000-4000-8000-000000000001', 30, 'unw_admin_delete_mcp_client', '{"clientId":"{zeroId}"}', '{}', 'refused', 'Delete an MCP client'),
  ('7d0f0007-0000-4000-8000-000000000001', 31, 'unw_admin_prune_mcp_clients', '{}', '{}', 'refused', 'Prune unused MCP clients');
