-- Catalog tables for billing hardcodes. Empty: the app still reads TypeScript constants.
-- Proposal.catalog_version_id and Contract.catalog_version_id stay null until a later change snapshots a version.

CREATE TYPE "ScheduleAmountRule" AS ENUM ('percent_of_total', 'zero');
CREATE TYPE "LeftoverCentTarget" AS ENUM ('last_entry');
CREATE TYPE "UnscopedRemainderRule" AS ENUM ('sole_or_final_milestone');
CREATE TYPE "RetainagePolicy" AS ENUM ('add_on_accept');

CREATE TABLE "catalog_version" (
    "id" UUID NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "catalog_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_model" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "code" "PricingModel" NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pricing_model_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_tier" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "pricing_model_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "hours" INTEGER,
    "min_amount_minor" INTEGER,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "price_tier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_schedule_template" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "pricing_model_id" UUID NOT NULL,
    "percent_basis" INTEGER NOT NULL,
    "leftover_cent_target" "LeftoverCentTarget" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_schedule_template_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_schedule_template_line" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "trigger" "BillingTrigger" NOT NULL,
    "percent_basis" INTEGER NOT NULL,
    "amount_minor" INTEGER,
    "amount_rule" "ScheduleAmountRule" NOT NULL,
    "due_offset_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_schedule_template_line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_policy" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "signing_due_offset_days" INTEGER NOT NULL,
    "milestone_due_offset_days" INTEGER NOT NULL,
    "prefer_milestone_due_date" BOOLEAN NOT NULL,
    "initial_status" "InvoiceStatus" NOT NULL,
    "unscoped_remainder_rule" "UnscopedRemainderRule" NOT NULL,
    "retainage_policy" "RetainagePolicy" NOT NULL,
    "invoice_on_sign" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoice_policy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_status_transition" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "from_status" "InvoiceStatus" NOT NULL,
    "to_status" "InvoiceStatus" NOT NULL,
    "staff_only" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_status_transition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oauth_scope" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "mcp" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_scope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_scope_grant" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_scope_grant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pricing_model_catalog_version_id_code_key" ON "pricing_model"("catalog_version_id", "code");
CREATE UNIQUE INDEX "price_tier_catalog_version_id_code_key" ON "price_tier"("catalog_version_id", "code");
CREATE INDEX "price_tier_pricing_model_id_idx" ON "price_tier"("pricing_model_id");
CREATE UNIQUE INDEX "billing_schedule_template_catalog_version_id_pricing_model_id_key" ON "billing_schedule_template"("catalog_version_id", "pricing_model_id");
CREATE UNIQUE INDEX "billing_schedule_template_line_template_id_sort_order_key" ON "billing_schedule_template_line"("template_id", "sort_order");
CREATE UNIQUE INDEX "billing_schedule_template_line_template_id_label_key" ON "billing_schedule_template_line"("template_id", "label");
CREATE UNIQUE INDEX "invoice_policy_catalog_version_id_key" ON "invoice_policy"("catalog_version_id");
CREATE UNIQUE INDEX "invoice_status_transition_catalog_version_id_from_status_to_status_key" ON "invoice_status_transition"("catalog_version_id", "from_status", "to_status");
CREATE UNIQUE INDEX "oauth_scope_catalog_version_id_scope_key" ON "oauth_scope"("catalog_version_id", "scope");
CREATE UNIQUE INDEX "session_scope_grant_catalog_version_id_role_scope_key" ON "session_scope_grant"("catalog_version_id", "role", "scope");
CREATE INDEX "session_scope_grant_catalog_version_id_role_idx" ON "session_scope_grant"("catalog_version_id", "role");
CREATE INDEX "catalog_version_effective_from_effective_to_idx" ON "catalog_version"("effective_from", "effective_to");

ALTER TABLE "pricing_model" ADD CONSTRAINT "pricing_model_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "price_tier" ADD CONSTRAINT "price_tier_pricing_model_id_fkey" FOREIGN KEY ("pricing_model_id") REFERENCES "pricing_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_schedule_template" ADD CONSTRAINT "billing_schedule_template_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_schedule_template" ADD CONSTRAINT "billing_schedule_template_pricing_model_id_fkey" FOREIGN KEY ("pricing_model_id") REFERENCES "pricing_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_schedule_template_line" ADD CONSTRAINT "billing_schedule_template_line_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "billing_schedule_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_policy" ADD CONSTRAINT "invoice_policy_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoice_status_transition" ADD CONSTRAINT "invoice_status_transition_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_scope" ADD CONSTRAINT "oauth_scope_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_scope_grant" ADD CONSTRAINT "session_scope_grant_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Proposal" ADD COLUMN "catalog_version_id" UUID;
ALTER TABLE "Contract" ADD COLUMN "catalog_version_id" UUID;
ALTER TABLE "Contract" ADD COLUMN "billing_schedule_template_id" UUID;

CREATE INDEX "Proposal_catalog_version_id_idx" ON "Proposal"("catalog_version_id");
CREATE INDEX "Contract_catalog_version_id_idx" ON "Contract"("catalog_version_id");
CREATE INDEX "Contract_billing_schedule_template_id_idx" ON "Contract"("billing_schedule_template_id");

ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_billing_schedule_template_id_fkey" FOREIGN KEY ("billing_schedule_template_id") REFERENCES "billing_schedule_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
