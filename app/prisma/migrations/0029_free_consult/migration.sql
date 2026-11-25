-- Free consult intake. The offering (price, limit, wording) is a row; an intake creates a draft proposal.
-- scheduled_at and booking_reference are left null for a calendar booking component designed later.
CREATE TABLE "consult_offering" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "engagement" "EngagementKind" NOT NULL,
    "pricing_model" "PricingModel" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "per_client_limit" INTEGER,
    "limit_scope" TEXT NOT NULL DEFAULT 'organization',
    "proposal_title_template" TEXT NOT NULL,
    "limit_message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "consult_offering_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "consult_offering_amount_check" CHECK ("amount_minor" >= 0),
    CONSTRAINT "consult_offering_duration_check" CHECK ("duration_minutes" > 0),
    CONSTRAINT "consult_offering_limit_check" CHECK ("per_client_limit" IS NULL OR "per_client_limit" >= 0),
    CONSTRAINT "consult_offering_limit_scope_check" CHECK ("limit_scope" IN ('organization', 'user'))
);

INSERT INTO "consult_offering" ("code", "label", "description", "engagement", "pricing_model", "amount_minor", "currency", "duration_minutes", "per_client_limit", "limit_scope", "proposal_title_template", "limit_message", "sort_order") VALUES
    ('free_consult', 'Free consult', 'A free conversation about one workflow. We listen, ask questions, and suggest a next step.', 'fixed_price', 'fixed_price', 0, 'USD', 30, 1, 'organization', 'Free consult: {topic}', 'You have already used your free consult. We are happy to scope a Workflow Check instead.', 10)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "consult_intake" (
    "id" UUID NOT NULL,
    "offering_code" TEXT NOT NULL,
    "proposal_id" UUID NOT NULL,
    "organization_id" UUID,
    "user_id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "details" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "booking_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consult_intake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "consult_intake_proposal_id_key" ON "consult_intake"("proposal_id");
CREATE INDEX "consult_intake_offering_org_idx" ON "consult_intake"("offering_code", "organization_id");
CREATE INDEX "consult_intake_offering_user_idx" ON "consult_intake"("offering_code", "user_id");
ALTER TABLE "consult_intake" ADD CONSTRAINT "consult_intake_offering_code_fkey" FOREIGN KEY ("offering_code") REFERENCES "consult_offering"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consult_intake" ADD CONSTRAINT "consult_intake_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consult_intake" ADD CONSTRAINT "consult_intake_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
