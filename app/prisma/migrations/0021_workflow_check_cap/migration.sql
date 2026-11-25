-- Workflow Check hour cap lives on the product's price tier. The existing hour-cap check reads price_tier.hours.
UPDATE "price_tier" SET "hours" = 3, "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'workflow_check' AND "hours" IS NULL;

CREATE TABLE "proposal_intake_park" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "summary" TEXT NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_intake_park_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "proposal_intake_park_proposal_id_created_at_idx" ON "proposal_intake_park"("proposal_id", "created_at");
ALTER TABLE "proposal_intake_park" ADD CONSTRAINT "proposal_intake_park_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
