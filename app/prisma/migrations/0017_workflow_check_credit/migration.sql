-- Workflow Check follow-on credit. Rules live on the catalog version.
-- credit_percent_basis uses the schedule scale: 1000000 is 100%.
-- v1 credits 100% of the Workflow Check fee toward a capped, fixed, or hourly contract for 30 days.

CREATE TABLE "credit_rule" (
    "id" UUID NOT NULL,
    "catalog_version_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "source_pricing_model" "PricingModel" NOT NULL,
    "source_tier_code" TEXT NOT NULL DEFAULT '',
    "window_days" INTEGER NOT NULL,
    "credit_amount_minor" INTEGER,
    "credit_percent_basis" INTEGER,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "credit_rule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_rule_window_check" CHECK ("window_days" > 0),
    CONSTRAINT "credit_rule_value_check" CHECK (
        ("credit_amount_minor" IS NOT NULL AND "credit_amount_minor" >= 0)
        OR ("credit_percent_basis" IS NOT NULL AND "credit_percent_basis" >= 0 AND "credit_percent_basis" <= 1000000)
    )
);

CREATE TABLE "credit_rule_target" (
    "id" UUID NOT NULL,
    "credit_rule_id" UUID NOT NULL,
    "pricing_model" "PricingModel" NOT NULL,
    "tier_code" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "credit_rule_target_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_credit" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "source_contract_id" UUID NOT NULL,
    "source_invoice_id" UUID NOT NULL,
    "credit_rule_id" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "redeemed_invoice_id" UUID,
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_credit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_rule_catalog_version_id_code_key" ON "credit_rule"("catalog_version_id", "code");
CREATE UNIQUE INDEX "credit_rule_target_credit_rule_id_pricing_model_tier_code_key" ON "credit_rule_target"("credit_rule_id", "pricing_model", "tier_code");
CREATE UNIQUE INDEX "contract_credit_source_contract_id_key" ON "contract_credit"("source_contract_id");
CREATE UNIQUE INDEX "contract_credit_source_invoice_id_key" ON "contract_credit"("source_invoice_id");
CREATE INDEX "contract_credit_organization_id_expires_at_idx" ON "contract_credit"("organization_id", "expires_at");

ALTER TABLE "credit_rule" ADD CONSTRAINT "credit_rule_catalog_version_id_fkey" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_rule_target" ADD CONSTRAINT "credit_rule_target_credit_rule_id_fkey" FOREIGN KEY ("credit_rule_id") REFERENCES "credit_rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_credit" ADD CONSTRAINT "contract_credit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_credit" ADD CONSTRAINT "contract_credit_source_contract_id_fkey" FOREIGN KEY ("source_contract_id") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_credit" ADD CONSTRAINT "contract_credit_source_invoice_id_fkey" FOREIGN KEY ("source_invoice_id") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_credit" ADD CONSTRAINT "contract_credit_redeemed_invoice_id_fkey" FOREIGN KEY ("redeemed_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contract_credit" ADD CONSTRAINT "contract_credit_credit_rule_id_fkey" FOREIGN KEY ("credit_rule_id") REFERENCES "credit_rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "credit_rule" (
    "id", "catalog_version_id", "code", "source_pricing_model", "source_tier_code",
    "window_days", "credit_amount_minor", "credit_percent_basis", "currency", "created_at", "updated_at"
) VALUES (
    '00000000-0000-4000-8000-000000000091',
    '00000000-0000-4000-8000-000000000001',
    'workflow_check_follow_on',
    'workflow_check',
    'workflow_check',
    30,
    NULL,
    1000000,
    'USD',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "credit_rule_target" ("id", "credit_rule_id", "pricing_model", "tier_code")
VALUES
    ('00000000-0000-4000-8000-000000000092', '00000000-0000-4000-8000-000000000091', 'capped_hours', ''),
    ('00000000-0000-4000-8000-000000000093', '00000000-0000-4000-8000-000000000091', 'fixed_price', ''),
    ('00000000-0000-4000-8000-000000000094', '00000000-0000-4000-8000-000000000091', 'hourly', '')
ON CONFLICT ("id") DO NOTHING;
