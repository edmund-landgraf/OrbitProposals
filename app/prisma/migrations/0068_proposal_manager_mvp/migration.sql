CREATE TABLE "proposal_source_document" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "content" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "extracted_at" TIMESTAMP(3),
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_source_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_source_document_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_source_document_proposal_id_created_at_idx" ON "proposal_source_document"("proposal_id", "created_at");

CREATE TABLE "proposal_requirement" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "source_document_id" UUID,
  "text" TEXT NOT NULL,
  "requirement_type" TEXT NOT NULL,
  "source_reference" TEXT,
  "mandatory" BOOLEAN NOT NULL DEFAULT false,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'unmapped',
  "owner_id" UUID,
  "due_at" TIMESTAMP(3),
  "mapped_node_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_requirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_requirement_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_requirement_proposal_id_status_mandatory_idx" ON "proposal_requirement"("proposal_id", "status", "mandatory");
CREATE INDEX "proposal_requirement_source_document_id_idx" ON "proposal_requirement"("source_document_id");

CREATE TABLE "proposal_manager_task" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "task_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "owner_id" UUID,
  "section_key" TEXT,
  "requirement_id" UUID,
  "depends_on_task_id" UUID,
  "due_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "note" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_manager_task_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_manager_task_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_manager_task_proposal_id_status_due_at_idx" ON "proposal_manager_task"("proposal_id", "status", "due_at");
CREATE INDEX "proposal_manager_task_owner_id_status_due_at_idx" ON "proposal_manager_task"("owner_id", "status", "due_at");

CREATE TABLE "proposal_go_no_go_assessment" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "decision" TEXT,
  "score" INTEGER,
  "factors" JSONB NOT NULL DEFAULT '[]',
  "rationale" TEXT,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMP(3),
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "proposal_go_no_go_assessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_go_no_go_assessment_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_go_no_go_assessment_proposal_id_status_updated_at_idx" ON "proposal_go_no_go_assessment"("proposal_id", "status", "updated_at");

CREATE TABLE "proposal_scope_baseline" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "items" JSONB NOT NULL DEFAULT '[]',
  "assumptions" JSONB NOT NULL DEFAULT '[]',
  "exclusions" JSONB NOT NULL DEFAULT '[]',
  "risks" JSONB NOT NULL DEFAULT '[]',
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_scope_baseline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_scope_baseline_proposal_id_version_key" UNIQUE ("proposal_id", "version"),
  CONSTRAINT "proposal_scope_baseline_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_scope_baseline_proposal_id_created_at_idx" ON "proposal_scope_baseline"("proposal_id", "created_at");

CREATE TABLE "proposal_pricing_model" (
  "id" UUID NOT NULL,
  "proposal_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "currency" TEXT NOT NULL,
  "lines" JSONB NOT NULL DEFAULT '[]',
  "options" JSONB NOT NULL DEFAULT '[]',
  "totals" JSONB NOT NULL DEFAULT '{}',
  "approval_status" TEXT NOT NULL DEFAULT 'draft',
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proposal_pricing_model_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "proposal_pricing_model_proposal_id_version_key" UNIQUE ("proposal_id", "version"),
  CONSTRAINT "proposal_pricing_model_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "proposal_pricing_model_proposal_id_created_at_idx" ON "proposal_pricing_model"("proposal_id", "created_at");

CREATE TABLE "content_library_item" (
  "id" UUID NOT NULL,
  "organization_id" UUID,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "owner_id" UUID,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_library_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "content_library_item_organization_id_status_category_idx" ON "content_library_item"("organization_id", "status", "category");
CREATE INDEX "content_library_item_expires_at_idx" ON "content_library_item"("expires_at");
