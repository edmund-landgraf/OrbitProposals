-- Agent trace store: one row per MCP tool call, with redacted input and output.
CREATE TABLE "agent_trace" (
  "id" UUID NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "mcp_client_id" UUID,
  "token_id" UUID,
  "user_id" UUID,
  "organization_id" UUID,
  "agent_name" TEXT,
  "session_ref" TEXT,
  "tool_name" TEXT NOT NULL,
  "input" JSONB NOT NULL DEFAULT '{}',
  "output" JSONB,
  "is_error" BOOLEAN NOT NULL DEFAULT false,
  "error_message" TEXT,
  "duration_ms" INTEGER NOT NULL,
  CONSTRAINT "agent_trace_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agent_trace_occurred_at_idx" ON "agent_trace" ("occurred_at" DESC);
CREATE INDEX "agent_trace_tool_name_occurred_at_idx" ON "agent_trace" ("tool_name", "occurred_at" DESC);
CREATE INDEX "agent_trace_mcp_client_id_occurred_at_idx" ON "agent_trace" ("mcp_client_id", "occurred_at" DESC);

-- Keys whose values are always replaced before a trace is stored. Matching is case-insensitive substring.
CREATE TABLE "agent_trace_redaction" (
  "pattern" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "agent_trace_redaction_pkey" PRIMARY KEY ("pattern")
);
INSERT INTO "agent_trace_redaction" ("pattern") VALUES
  ('token'), ('secret'), ('password'), ('authorization'), ('apikey'), ('api_key'), ('cookie'), ('otp'), ('totp'), ('recovery')
ON CONFLICT ("pattern") DO NOTHING;

-- Limits for the trace store, as rows.
CREATE TABLE "agent_trace_setting" (
  "key" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  CONSTRAINT "agent_trace_setting_pkey" PRIMARY KEY ("key")
);
INSERT INTO "agent_trace_setting" ("key", "value") VALUES
  ('max_payload_chars', 20000),
  ('retention_days', 30),
  ('list_default_limit', 50),
  ('list_max_limit', 200)
ON CONFLICT ("key") DO NOTHING;
