-- Optional, preselected, and required lines, grouped as single-select packages or multi-select sets.
-- Prices stay on the rows staff create. A client selection only changes which rows are selected.

ALTER TABLE "ProposalOption" ADD COLUMN "selection" TEXT NOT NULL DEFAULT 'optional';
ALTER TABLE "ProposalOption" ADD COLUMN "groupId" UUID;
ALTER TABLE "ProposalOption" ADD CONSTRAINT "ProposalOption_selection_check" CHECK ("selection" IN ('required', 'optional', 'preselected'));

CREATE TABLE "proposal_option_group" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    CONSTRAINT "proposal_option_group_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_option_group_mode_check" CHECK ("mode" IN ('single', 'multi'))
);

CREATE INDEX "proposal_option_group_proposalId_idx" ON "proposal_option_group"("proposalId");
ALTER TABLE "proposal_option_group" ADD CONSTRAINT "proposal_option_group_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProposalOption_groupId_idx" ON "ProposalOption"("groupId");
ALTER TABLE "ProposalOption" ADD CONSTRAINT "ProposalOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "proposal_option_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "proposal_node_template" ("key", "kind", "title", "client_label", "sort_order", "parent_key") VALUES
    ('options', 'option', 'Options', 'options', 35, 'price')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "proposal_node_edge_template" ("id", "from_key", "to_key") VALUES
    ('30000000-0000-4000-8000-000000000004', 'options', 'price')
ON CONFLICT ("id") DO NOTHING;
