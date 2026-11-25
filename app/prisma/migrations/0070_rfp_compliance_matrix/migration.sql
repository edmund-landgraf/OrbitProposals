ALTER TABLE "proposal_requirement" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "proposal_requirement" ADD COLUMN "suggested_node_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "proposal_requirement" ADD COLUMN "duplicate_of_id" UUID;
ALTER TABLE "proposal_requirement" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "proposal_requirement" SET "confirmed" = true WHERE "confidence" >= 1;

CREATE TABLE "proposal_compliance_signoff" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "signed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_compliance_signoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_compliance_signoff_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_compliance_signoff_proposal_id_created_at_idx" ON "proposal_compliance_signoff"("proposal_id", "created_at");
