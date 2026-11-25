-- One schedule per contract. Concurrent signs insert the same labels;
-- the loser fails this unique key instead of writing a second schedule.
CREATE UNIQUE INDEX "BillingEntry_contractId_label_key" ON public."BillingEntry" USING btree ("contractId", "label");
