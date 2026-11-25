ALTER TABLE "content_library_item" ADD COLUMN "stable_key" TEXT;
UPDATE "content_library_item" SET "stable_key" = "id"::text WHERE "stable_key" IS NULL;
ALTER TABLE "content_library_item" ALTER COLUMN "stable_key" SET NOT NULL;
CREATE UNIQUE INDEX "content_library_item_stable_key_key" ON "content_library_item"("stable_key");
ALTER TABLE "content_library_item" ADD COLUMN "client_label" TEXT;
ALTER TABLE "content_library_item" ADD COLUMN "guidance" TEXT NOT NULL DEFAULT '';
ALTER TABLE "content_library_item" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'organization';
ALTER TABLE "content_library_item" ADD COLUMN "source" TEXT;
ALTER TABLE "content_library_item" ADD COLUMN "industry" TEXT;
ALTER TABLE "content_library_item" ADD COLUMN "product" TEXT;
ALTER TABLE "content_library_item" ADD COLUMN "approved_version" INTEGER;
ALTER TABLE "content_library_item" ADD COLUMN "effective_from" TIMESTAMP(3);
UPDATE "content_library_item" SET "approved_version" = "version" WHERE "status" = 'approved' AND "approved_version" IS NULL;

CREATE TABLE "content_library_version" (
  "id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "guidance" TEXT NOT NULL DEFAULT '',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "change_summary" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "author_id" UUID,
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "superseded_by" INTEGER,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_library_version_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_library_version_item_id_version_key" UNIQUE ("item_id", "version"),
  CONSTRAINT "content_library_version_item_id_idempotency_key_key" UNIQUE ("item_id", "idempotency_key"),
  CONSTRAINT "content_library_version_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "content_library_item"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "content_library_version_item_id_created_at_idx" ON "content_library_version"("item_id", "created_at");

INSERT INTO "content_library_version" ("id", "item_id", "version", "title", "body", "guidance", "tags", "change_summary", "status", "author_id", "approved_by_id", "approved_at", "created_at")
SELECT gen_random_uuid(), "id", "version", "title", "body", "guidance", "tags", 'Backfilled from the library item.', "status", "owner_id",
  CASE WHEN "status" = 'approved' THEN "owner_id" ELSE NULL END,
  CASE WHEN "status" = 'approved' THEN "updated_at" ELSE NULL END,
  "created_at"
FROM "content_library_item";

CREATE TABLE "content_library_use" (
  "id" UUID NOT NULL,
  "item_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "proposal_id" UUID NOT NULL,
  "section_key" TEXT NOT NULL,
  "actor_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_library_use_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "content_library_use_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "content_library_item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "content_library_use_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "content_library_use_item_id_created_at_idx" ON "content_library_use"("item_id", "created_at");
CREATE INDEX "content_library_use_proposal_id_idx" ON "content_library_use"("proposal_id");
