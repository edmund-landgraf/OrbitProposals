ALTER TABLE "ChatSession" ADD COLUMN "publicTokenHash" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "submittedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "ChatSession_publicTokenHash_key" ON "ChatSession"("publicTokenHash");
CREATE INDEX "ChatSession_publicTokenHash_status_idx" ON "ChatSession"("publicTokenHash", "status");
