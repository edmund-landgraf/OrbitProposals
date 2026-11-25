ALTER TABLE "ProposalPublicLink" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "ProposalPublicLink_expiresAt_idx" ON "ProposalPublicLink"("expiresAt");
