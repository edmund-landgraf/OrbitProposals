-- Proposal templates: a template is a named subset of the node library (proposal_node_template),
-- with its own order and parent links. A proposal records the template it was built from.
CREATE TABLE "proposal_template" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "proposal_template_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_template_node" (
  "template_code" TEXT NOT NULL,
  "node_key" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "parent_key" TEXT,
  CONSTRAINT "proposal_template_node_pkey" PRIMARY KEY ("template_code", "node_key"),
  CONSTRAINT "proposal_template_node_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "proposal_template"("code") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "proposal_template_node_node_key_fkey" FOREIGN KEY ("node_key") REFERENCES "proposal_node_template"("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "proposal_template" ("code", "name", "description", "sort_order") VALUES
  ('standard', 'Standard proposal', 'Every part: scope, hours, price and options, milestones, schedule, terms, and the narrative sections.', 10)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "proposal_template_node" ("template_code", "node_key", "sort_order", "parent_key")
SELECT 'standard', "key", "sort_order", "parent_key" FROM "proposal_node_template"
ON CONFLICT DO NOTHING;

ALTER TABLE "Proposal" ADD COLUMN "template_code" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_template_code_fkey" FOREIGN KEY ("template_code") REFERENCES "proposal_template"("code") ON DELETE RESTRICT ON UPDATE CASCADE;