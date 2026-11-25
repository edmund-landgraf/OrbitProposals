-- Seeded Try me plan: add a library section to the draft after it picks a template.
UPDATE "try_me_task_call" SET "seq" = 6 WHERE "task_id" = '7d0f0001-0000-4000-8000-000000000003' AND "seq" = 4;
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0001-0000-4000-8000-000000000003', 4, 'unw_list_section_library', '{}', '{}', 'ok', 'See the reusable sections'),
  ('7d0f0001-0000-4000-8000-000000000003', 5, 'unw_add_proposal_section', '{"proposalId": "{proposalId}", "nodeKey": "integrations"}', '{}', 'ok', 'Add the integrations section')
ON CONFLICT ("task_id", "seq") DO NOTHING;
