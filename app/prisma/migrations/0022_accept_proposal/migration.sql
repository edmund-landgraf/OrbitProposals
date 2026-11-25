-- First invoice on proposal acceptance. One rule per pricing model per catalog version.
-- percent_basis uses the schedule scale: 1000000 is 100%.

CREATE TABLE "first_invoice_rule" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "pricing_model" "PricingModel" NOT NULL,
    "kind" TEXT NOT NULL,
    "percent_basis" INTEGER,
    "period_days" INTEGER,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "first_invoice_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "first_invoice_rule_kind_check" CHECK ("kind" IN ('deposit_percent', 'first_milestone', 'first_period')),
    CONSTRAINT "first_invoice_rule_percent_check" CHECK ("percent_basis" IS NULL OR ("percent_basis" >= 0 AND "percent_basis" <= 1000000)),
    CONSTRAINT "first_invoice_rule_period_check" CHECK ("period_days" IS NULL OR "period_days" >= 0)
);

CREATE UNIQUE INDEX "first_invoice_rule_catalog_version_id_pricing_model_key" ON "first_invoice_rule"("catalog_version_id", "pricing_model");

ALTER TABLE "first_invoice_rule" ADD CONSTRAINT "first_invoice_rule_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "first_invoice_rule" (
    "id", "catalog_version_id", "pricing_model", "kind", "percent_basis", "period_days", "label", "updated_at"
) VALUES
    ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'workflow_check', 'deposit_percent', 1000000, NULL, 'Workflow Check', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'capped_hours', 'deposit_percent', 1000000, NULL, 'Capped Hours', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-000000000001', 'fixed_price', 'deposit_percent', 500000, NULL, 'Deposit', CURRENT_TIMESTAMP),
    ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-000000000001', 'hourly', 'first_period', NULL, 30, 'First period', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Contract" ADD COLUMN "scope" JSONB;
ALTER TABLE "Contract" ADD COLUMN "pricing" JSONB;
ALTER TABLE "Contract" ADD COLUMN "accepted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "Contract_proposal_version_id_key" ON "Contract"("proposal_version_id");
