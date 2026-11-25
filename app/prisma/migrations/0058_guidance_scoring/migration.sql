-- Nightly guidance rule scoring evidence, plus outcome idempotency helpers.

ALTER TABLE "guidance_rule_score" ADD COLUMN "evidence" JSONB NOT NULL DEFAULT '{}';

-- One outcome code per event. event_id is nullable, so this only dedupes event-scoped outcomes.
CREATE UNIQUE INDEX IF NOT EXISTS "guidance_outcome_event_id_outcome_code_key" ON "guidance_outcome" ("event_id", "outcome_code");

