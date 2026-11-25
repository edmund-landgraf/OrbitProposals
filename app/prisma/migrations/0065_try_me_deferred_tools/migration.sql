-- Every registered MCP tool must appear in a Try me plan call.
-- These five are covered on the staff-queue task with the zero id, so a fresh sandbox refuses them
-- instead of charging, approving, or downloading a redline for a proposal that is not there.

INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0007-0000-4000-8000-000000000003', 105, 'unw_list_proposal_views', '{"proposalId":"{zeroId}"}', '{}', 'refused', 'Who opened the proposal (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 106, 'unw_export_redline', '{"proposalId":"{zeroId}","from":1,"to":2}', '{}', 'refused', 'Word redline (no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 107, 'unw_add_approval_step', '{"proposalId":"{zeroId}","label":"Sponsor"}', '{}', 'refused', 'Add an approver (staff, no such proposal)'),
  ('7d0f0007-0000-4000-8000-000000000003', 108, 'unw_record_approval', '{"proposalId":"{zeroId}","stepId":"{zeroId}"}', '{}', 'refused', 'Record an approval step (no such step)'),
  ('7d0f0007-0000-4000-8000-000000000003', 109, 'unw_charge_invoice', '{"invoiceId":"{zeroId}","paymentMethodId":"pm_card"}', '{}', 'refused', 'Charge an invoice (no such invoice)')
ON CONFLICT DO NOTHING;
