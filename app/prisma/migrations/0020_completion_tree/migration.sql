-- Completion tree: node states, weights, labels, dependency edges, and sentence templates are rows.

CREATE TABLE "proposal_node_state" (
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "client_label" TEXT NOT NULL,
  "completion_weight" INTEGER NOT NULL,
  "reopens_downstream" BOOLEAN NOT NULL DEFAULT false,
  "is_reopen_target" BOOLEAN NOT NULL DEFAULT false,
  "is_lock" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_node_state_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_node_template" (
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "parent_key" TEXT,
  CONSTRAINT "proposal_node_template_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "proposal_node_edge_template" (
  "id" UUID NOT NULL,
  "from_key" TEXT NOT NULL,
  "to_key" TEXT NOT NULL,
  CONSTRAINT "proposal_node_edge_template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_node_edge_template_from_key_to_key_key" ON "proposal_node_edge_template"("from_key", "to_key");

CREATE TABLE "proposal_completion_copy" (
  "code" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  CONSTRAINT "proposal_completion_copy_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_park_mode" (
  "code" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "reopens" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_park_mode_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "proposal_node" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "client_label" TEXT NOT NULL,
  "state_code" TEXT NOT NULL,
  "body" JSONB NOT NULL DEFAULT '{}',
  "locked_version_id" UUID,
  "sort_order" INTEGER NOT NULL,
  "parent_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_node_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_node_proposal_id_key_key" ON "proposal_node"("proposal_id", "key");
CREATE INDEX "proposal_node_proposal_id_state_code_idx" ON "proposal_node"("proposal_id", "state_code");
ALTER TABLE "proposal_node" ADD CONSTRAINT "proposal_node_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_node" ADD CONSTRAINT "proposal_node_locked_version_id_fkey" FOREIGN KEY ("locked_version_id") REFERENCES "proposal_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "proposal_node_edge" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "from_node_id" UUID NOT NULL,
  "to_node_id" UUID NOT NULL,
  CONSTRAINT "proposal_node_edge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_node_edge_from_node_id_to_node_id_key" ON "proposal_node_edge"("from_node_id", "to_node_id");
CREATE INDEX "proposal_node_edge_proposal_id_idx" ON "proposal_node_edge"("proposal_id");
ALTER TABLE "proposal_node_edge" ADD CONSTRAINT "proposal_node_edge_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_node_edge" ADD CONSTRAINT "proposal_node_edge_from_node_id_fkey" FOREIGN KEY ("from_node_id") REFERENCES "proposal_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "proposal_node_edge" ADD CONSTRAINT "proposal_node_edge_to_node_id_fkey" FOREIGN KEY ("to_node_id") REFERENCES "proposal_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_completion_event" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "percent_before" INTEGER NOT NULL,
  "percent_after" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_completion_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_completion_event_proposal_id_created_at_idx" ON "proposal_completion_event"("proposal_id", "created_at");
ALTER TABLE "proposal_completion_event" ADD CONSTRAINT "proposal_completion_event_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_parked_change" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "node_key" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "swap_summary" TEXT,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_parked_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_parked_change_proposal_id_created_at_idx" ON "proposal_parked_change"("proposal_id", "created_at");
ALTER TABLE "proposal_parked_change" ADD CONSTRAINT "proposal_parked_change_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "proposal_node_state" ("code", "sort_order", "client_label", "completion_weight", "reopens_downstream", "is_reopen_target", "is_lock") VALUES
  ('open', 10, 'Not started', 0, false, false, false),
  ('drafted', 20, 'Drafted', 0, false, false, false),
  ('needs_review', 30, 'Needs another look', 0, false, true, false),
  ('agreed', 40, 'Agreed', 1, true, false, false),
  ('locked', 50, 'Locked', 1, true, false, true);

INSERT INTO "proposal_node_template" ("key", "kind", "title", "client_label", "sort_order", "parent_key") VALUES
  ('scope', 'scope', 'Scope', 'scope', 10, NULL),
  ('hours', 'hours', 'Hours', 'hours', 20, 'scope'),
  ('price', 'price', 'Price', 'price', 30, 'hours'),
  ('milestones', 'milestone', 'Milestones', 'milestones', 40, 'scope'),
  ('schedule', 'schedule', 'Schedule', 'dates', 50, NULL),
  ('terms', 'terms', 'Terms', 'terms', 60, NULL);

INSERT INTO "proposal_node_edge_template" ("id", "from_key", "to_key") VALUES
  ('30000000-0000-4000-8000-000000000001', 'scope', 'hours'),
  ('30000000-0000-4000-8000-000000000002', 'hours', 'price'),
  ('30000000-0000-4000-8000-000000000003', 'scope', 'milestones');

INSERT INTO "proposal_completion_copy" ("code", "template") VALUES
  ('impact_reopen', 'Adding {change} reopens {reopened}: {before}% to {after}%; {held} stay locked.'),
  ('impact_clear', 'Adding {change} reopens nothing else: {before}% to {after}%; {held} stay locked.');

INSERT INTO "proposal_park_mode" ("code", "client_label", "reopens") VALUES
  ('phase_2', 'Park as a later phase', false),
  ('swap', 'Swap for a similar item', false);
