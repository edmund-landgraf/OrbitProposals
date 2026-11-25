-- Terms is a completion-tree part (kind 'terms') but had no ProposalSectionSpec, so
-- unw_update_proposal_section / PUT /narrative/terms returned 404. Seed the spec so
-- terms can be written and read like the other narrative parts.
-- Also add progress-copy rows that distinguish not-started, drafted, and reopened parts
-- in the handoff summary, instead of calling every unsettled part "still open".

INSERT INTO "proposal_section_spec" ("node_key", "guidance", "max_chars", "written_state") VALUES
  ('terms', 'Payment, legal, and working terms both sides will live with: invoicing, what the client must provide, what is out of scope for this phase, and any professional or regulatory constraints. Never state hours or price.', 6000, 'drafted')
ON CONFLICT ("node_key") DO NOTHING;

INSERT INTO "proposal_progress_copy" ("code", "template") VALUES
  ('drafted_for_review', 'Drafted, awaiting agreement: {parts}.'),
  ('reopened_for_review', 'Needs another look: {parts}.')
ON CONFLICT ("code") DO NOTHING;
