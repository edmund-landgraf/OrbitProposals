-- Duplicate and revise: lineage between a proposal and the copy made from it,
-- plus the engagement -> pricing model rows a copy uses when its engagement changes.
CREATE TABLE "engagement_pricing_model" (
  "engagement" "EngagementKind" PRIMARY KEY,
  "pricing_model" "PricingModel" NOT NULL,
  "pending_price_message" TEXT NOT NULL
);
INSERT INTO "engagement_pricing_model" ("engagement", "pricing_model", "pending_price_message") VALUES
  ('workflow_check', 'workflow_check', 'Staff will confirm the price for this copy.'),
  ('capped_hours_4', 'capped_hours', 'Staff will confirm the price for this copy.'),
  ('capped_hours_8', 'capped_hours', 'Staff will confirm the price for this copy.'),
  ('fixed_price', 'fixed_price', 'Staff will confirm the price for this copy.'),
  ('hourly', 'hourly', 'Staff will confirm the price for this copy.');

CREATE TABLE "proposal_lineage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "proposal_id" UUID NOT NULL UNIQUE REFERENCES "Proposal"("id") ON DELETE CASCADE,
  "source_proposal_id" UUID REFERENCES "Proposal"("id") ON DELETE SET NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "engagement_changed" BOOLEAN NOT NULL DEFAULT false,
  "actor_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "proposal_lineage_source_idx" ON "proposal_lineage"("source_proposal_id");
