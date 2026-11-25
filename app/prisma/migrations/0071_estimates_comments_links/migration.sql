ALTER TABLE "TimelineMilestone" ADD COLUMN "hoursLow" INTEGER;
ALTER TABLE "TimelineMilestone" ADD COLUMN "hoursHigh" INTEGER;

ALTER TABLE "proposal_attachment" ADD COLUMN "source_url" TEXT;

INSERT INTO "proposal_review_comment_status" ("code", "open") VALUES ('superseded', false)
ON CONFLICT ("code") DO NOTHING;
