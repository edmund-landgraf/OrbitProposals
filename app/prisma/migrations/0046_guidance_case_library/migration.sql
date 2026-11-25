-- Approach B case library seeded from staff good/bad feedback.
CREATE TABLE "guidance_feedback_rating" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "polarity" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "guidance_feedback_rating" ("code", "label", "polarity", "sort_order") VALUES
  ('good', 'Good', 1, 1),
  ('bad', 'Bad', -1, 2)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "guidance_case_status" (
  "code" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT NOT NULL,
  "agent_visible" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "guidance_case_status" ("code", "label", "agent_visible", "sort_order") VALUES
  ('draft', 'Draft', false, 1),
  ('approved', 'Approved', true, 2),
  ('retired', 'Retired', false, 3)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "guidance_case" (
  "id" UUID NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "situation" TEXT NOT NULL,
  "signals" JSONB NOT NULL DEFAULT '{}',
  "move" TEXT REFERENCES "guidance_move"("key"),
  "client_phrase" TEXT,
  "lesson" TEXT NOT NULL,
  "polarity" INTEGER NOT NULL DEFAULT 0,
  "status_code" TEXT NOT NULL DEFAULT 'draft' REFERENCES "guidance_case_status"("code"),
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "proposal_id" UUID,
  "event_id" UUID,
  "feedback_id" UUID,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "guidance_case_key_key" ON "guidance_case"("key");
CREATE UNIQUE INDEX "guidance_case_feedback_id_key" ON "guidance_case"("feedback_id");
CREATE INDEX "guidance_case_status_code_idx" ON "guidance_case"("status_code");

-- Seeded Try me plan: look up similar approved cases at the end of the run.
INSERT INTO "try_me_task_call" ("task_id", "seq", "tool_name", "arguments", "capture", "expect", "note") VALUES
  ('7d0f0001-0000-4000-8000-000000000003', 7, 'unw_find_guidance_cases', '{"proposalId": "{proposalId}"}', '{}', 'ok', 'Look up similar past cases')
ON CONFLICT ("task_id", "seq") DO NOTHING;
