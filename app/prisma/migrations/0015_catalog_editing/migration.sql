-- Draft catalog versions are editable. Published versions are not.
-- catalog:write is the staff scope for those edits.

CREATE TYPE "CatalogVersionStatus" AS ENUM ('draft', 'published');

ALTER TABLE "catalog_version" ADD COLUMN "status" "CatalogVersionStatus" NOT NULL DEFAULT 'published';

INSERT INTO "oauth_scope" ("id", "catalog_version_id", "scope", "mcp", "created_at")
VALUES (
  '00000000-0000-4000-8000-000000000079',
  '00000000-0000-4000-8000-000000000001',
  'catalog:write',
  TRUE,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "oauth_scope" ("id", "catalog_version_id", "scope", "mcp", "created_at")
VALUES (
  '00000000-0000-4000-8000-00000000007a',
  '00000000-0000-4000-8000-000000000001',
  'admin',
  TRUE,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "session_scope_grant" ("id", "catalog_version_id", "role", "scope", "created_at")
VALUES (
  '00000000-0000-4000-8000-000000000089',
  '00000000-0000-4000-8000-000000000001',
  'staff',
  'catalog:write',
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
