-- Proposal narrative sections: executive summary, problem/background, approach, success metrics.
-- Each section is a completion-tree node template (kind 'section') plus a spec row that holds
-- the agent's guidance, the length limit, and the node state a write moves the part to.
CREATE TABLE "proposal_section_spec" (
  "node_key" TEXT NOT NULL,
  "guidance" TEXT NOT NULL,
  "max_chars" INTEGER NOT NULL,
  "written_state" TEXT NOT NULL,
  CONSTRAINT "proposal_section_spec_pkey" PRIMARY KEY ("node_key"),
  CONSTRAINT "proposal_section_spec_node_key_fkey" FOREIGN KEY ("node_key") REFERENCES "proposal_node_template"("key") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proposal_section_spec_written_state_fkey" FOREIGN KEY ("written_state") REFERENCES "proposal_node_state"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "proposal_node_template" ("key", "kind", "title", "client_label", "sort_order", "parent_key") VALUES
  ('executive_summary', 'section', 'Executive summary', 'executive summary', 70, NULL),
  ('background', 'section', 'Problem and background', 'problem and background', 80, NULL),
  ('approach', 'section', 'Approach', 'approach', 90, NULL),
  ('success_metrics', 'section', 'Success metrics', 'success metrics', 100, NULL)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "proposal_section_spec" ("node_key", "guidance", "max_chars", "written_state") VALUES
  ('executive_summary', 'Two or three short paragraphs a decision-maker can read alone: the need, what will be delivered, and why this engagement fits. Never state hours or price.', 3000, 'drafted'),
  ('background', 'The client''s problem in their own words: current situation, what it costs them, and what has been tried.', 4000, 'drafted'),
  ('approach', 'How the work will be done: method, phases, and how the client stays involved. Describe the work, not the schedule or price.', 6000, 'drafted'),
  ('success_metrics', 'How both sides will know the engagement worked: measurable outcomes or acceptance signals the client agrees with.', 3000, 'drafted')
ON CONFLICT ("node_key") DO NOTHING;
