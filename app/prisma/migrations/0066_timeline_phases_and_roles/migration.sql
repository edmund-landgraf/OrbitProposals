ALTER TABLE "TimelineMilestone"
  ADD COLUMN "weeksLow" INTEGER,
  ADD COLUMN "weeksHigh" INTEGER,
  ADD COLUMN "gate" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "actualStart" TIMESTAMP(3),
  ADD COLUMN "actualEnd" TIMESTAMP(3);

CREATE TABLE "proposal_role" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "responsibility" TEXT NOT NULL,
  "heaviest_all" BOOLEAN NOT NULL DEFAULT false,
  "heaviest_gates" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "proposal_role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "proposal_role_phase" (
  "role_id" UUID NOT NULL,
  "milestone_id" UUID NOT NULL,
  CONSTRAINT "proposal_role_phase_pkey" PRIMARY KEY ("role_id","milestone_id")
);

CREATE INDEX "proposal_role_proposal_id_sort_order_idx" ON "proposal_role"("proposal_id", "sort_order");

ALTER TABLE "proposal_role"
  ADD CONSTRAINT "proposal_role_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "proposal_role_phase"
  ADD CONSTRAINT "proposal_role_phase_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "proposal_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "proposal_role_phase"
  ADD CONSTRAINT "proposal_role_phase_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "TimelineMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
