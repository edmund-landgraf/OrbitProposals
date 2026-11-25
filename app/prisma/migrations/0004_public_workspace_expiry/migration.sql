ALTER TABLE "ChatSession" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "ChatSession_expiresAt_idx" ON "ChatSession"("expiresAt");
