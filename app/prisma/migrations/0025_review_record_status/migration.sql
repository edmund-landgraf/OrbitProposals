-- Proposal.status follows the review state machine. The mapping is data, not code.
ALTER TABLE "proposal_review_status" ADD COLUMN "record_status" "RecordStatus";

UPDATE "proposal_review_status" SET "record_status" = 'draft' WHERE "code" IN ('draft', 'client_revising');
UPDATE "proposal_review_status" SET "record_status" = 'pending_approval' WHERE "code" IN ('agent_review', 'in_review', 'changes_requested', 'resubmitted', 'review_meeting_scheduled');
UPDATE "proposal_review_status" SET "record_status" = 'active' WHERE "code" = 'approved';
UPDATE "proposal_review_status" SET "record_status" = 'closed' WHERE "code" IN ('rejected', 'withdrawn');

-- Backfill proposals already moved by the review flow.
UPDATE "Proposal" p SET "status" = s."record_status"
FROM "proposal_review_status" s
WHERE s."code" = p."review_state" AND s."record_status" IS NOT NULL AND p."review_state" <> 'draft' AND p."status" <> s."record_status"
  AND NOT (p."status" = 'active' AND p."review_state" = 'approved');
