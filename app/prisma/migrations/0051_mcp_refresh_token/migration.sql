-- OAuth refresh_token grant for MCP connectors. Each access token row carries its own refresh token; a refresh rotates both.
ALTER TABLE public."McpToken" ADD COLUMN "refreshTokenHash" TEXT;
ALTER TABLE public."McpToken" ADD COLUMN "refreshExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "McpToken_refreshTokenHash_key" ON public."McpToken"("refreshTokenHash");

-- Token lifetimes live in rows, not code.
CREATE TABLE public."mcp_token_setting" (
  "code" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "note" TEXT,
  CONSTRAINT "mcp_token_setting_pkey" PRIMARY KEY ("code")
);
INSERT INTO public."mcp_token_setting" ("code", "value", "note") VALUES
  ('access_token_ttl_days', 30, 'Days an MCP connector access token is valid.'),
  ('refresh_token_ttl_days', 90, 'Days an MCP connector refresh token is valid. Each refresh rotates it and restarts this window.')
ON CONFLICT ("code") DO NOTHING;
