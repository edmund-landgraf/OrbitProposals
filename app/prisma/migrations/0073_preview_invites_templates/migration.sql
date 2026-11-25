ALTER TABLE "proposal_manager_task" ADD COLUMN "assignee_name" TEXT;
ALTER TABLE "proposal_manager_task" ADD COLUMN "assignee_email" TEXT;
ALTER TABLE "proposal_manager_task" ADD COLUMN "side" TEXT NOT NULL DEFAULT 'us';

ALTER TABLE "proposal_template" ADD COLUMN "outline" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "proposal_guest_invite" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "task_id" UUID,
  "status" TEXT NOT NULL DEFAULT 'invited',
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_guest_invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_guest_invite_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_guest_invite_proposal_id_email_idx" ON "proposal_guest_invite"("proposal_id", "email");
