ALTER TABLE "McpToken" ADD COLUMN "userId" UUID;
CREATE INDEX "McpToken_userId_revokedAt_idx" ON "McpToken"("userId", "revokedAt");
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
