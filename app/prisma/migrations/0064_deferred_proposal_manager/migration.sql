-- View analytics, an approval chain, and a record of processor charges.
-- Word redlines are generated on request and are not stored.

CREATE TABLE "proposal_view" (
  "id" UUID NOT NULL,
  "proposalId" UUID NOT NULL,
  "viewerId" UUID NOT NULL,
  "section_key" TEXT,
  "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_view_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "proposal_view_proposalId_seen_at_idx" ON "proposal_view"("proposalId", "seen_at");
ALTER TABLE "proposal_view" ADD CONSTRAINT "proposal_view_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_approval_step" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  CONSTRAINT "proposal_approval_step_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "proposal_approval_step_proposal_id_sort_order_idx" ON "proposal_approval_step"("proposal_id", "sort_order");
ALTER TABLE "proposal_approval_step" ADD CONSTRAINT "proposal_approval_step_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "proposal_approval" (
  "id" UUID NOT NULL,
  "step_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_approval_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "proposal_approval_step_id_key" ON "proposal_approval"("step_id");
ALTER TABLE "proposal_approval" ADD CONSTRAINT "proposal_approval_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "proposal_approval_step"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoice_charge" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "processor" TEXT NOT NULL,
  "processor_id" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_charge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_charge_invoiceId_idx" ON "invoice_charge"("invoiceId");
ALTER TABLE "invoice_charge" ADD CONSTRAINT "invoice_charge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
