-- Tie a billing entry to the milestone that invoices it.
-- Null means the entry is still unassigned. Unassigned milestone_accepted
-- rows are invoiced by the contract's only milestone, or by the final
-- milestone when the contract has more than one.

ALTER TABLE public."BillingEntry" ADD COLUMN "milestoneId" UUID;

CREATE INDEX "BillingEntry_milestoneId_idx" ON public."BillingEntry" USING btree ("milestoneId");

ALTER TABLE ONLY public."BillingEntry"
    ADD CONSTRAINT "BillingEntry_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES public."Milestone"(id) ON UPDATE CASCADE ON DELETE SET NULL;
