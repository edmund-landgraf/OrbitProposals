-- Seeded Try me plan: reorder the added integrations section to the front, then remove it again.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0001-0000-4000-8000-000000000003', 8, 'unw_reorder_proposal_sections', '{"proposalId": "{proposalId}", "keys": ["integrations"]}', '{}', 'ok', 'Move the integrations section first'),
  ('7d0f0001-0000-4000-8000-000000000003', 9, 'unw_remove_proposal_section', '{"proposalId": "{proposalId}", "nodeKey": "integrations"}', '{}', 'ok', 'Remove the integrations section again')
ON CONFLICT ("task_id", "seq") DO NOTHING;
