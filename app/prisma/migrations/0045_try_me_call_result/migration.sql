-- Try me: keep each call's actual MCP response (or error body) so the page can show it when a visitor clicks the call.
ALTER TABLE "try_me_session_call" ADD COLUMN "result" JSONB;
