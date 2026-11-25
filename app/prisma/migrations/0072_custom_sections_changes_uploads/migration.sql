CREATE TABLE "proposal_upload_part" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "part_index" INTEGER NOT NULL,
  "part_count" INTEGER NOT NULL,
  "bytes" BYTEA NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_upload_part_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_upload_part_proposal_id_filename_part_index_key" UNIQUE ("proposal_id", "filename", "part_index"),
  CONSTRAINT "proposal_upload_part_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_upload_part_proposal_id_filename_idx" ON "proposal_upload_part"("proposal_id", "filename");

CREATE TABLE "proposal_change_item" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "approver_name" TEXT NOT NULL,
  "due_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'open',
  "decision" TEXT,
  "decision_note" TEXT,
  "decided_at" TIMESTAMP(3),
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_change_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_change_item_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_change_item_proposal_id_kind_status_idx" ON "proposal_change_item"("proposal_id", "kind", "status");
