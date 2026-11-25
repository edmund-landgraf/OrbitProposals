CREATE TABLE "ProposalPublicLink" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ProposalPublicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposalPublicLink_tokenHash_key" ON "ProposalPublicLink"("tokenHash");
CREATE INDEX "ProposalPublicLink_proposalId_revokedAt_idx" ON "ProposalPublicLink"("proposalId", "revokedAt");
ALTER TABLE "ProposalPublicLink" ADD CONSTRAINT "ProposalPublicLink_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
