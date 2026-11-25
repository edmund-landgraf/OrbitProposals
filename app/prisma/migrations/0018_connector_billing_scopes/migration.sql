-- Advertise billing and catalog scopes on every catalog version, and grant them
-- to staff. Connector OAuth only issues scopes that have an oauth_scope row
-- with mcp=true on the active version. Versions published after the v1 seed
-- (or cloned before catalog:write existed) can omit those rows, so a connector
-- cannot request or receive billing:read, billing:write, or catalog:write.
-- Staff session grants are what a staff or admin connector receives in addition
-- to the scopes the client asked for.

UPDATE "oauth_scope"
SET "mcp" = TRUE
WHERE "scope" IN ('billing:read', 'billing:write', 'catalog:write')
  AND "mcp" = FALSE;

INSERT INTO "oauth_scope" ("id", "catalog_version_id", "scope", "mcp", "created_at")
SELECT gen_random_uuid(), version."id", scope.scope, TRUE, CURRENT_TIMESTAMP
FROM "catalog_version" AS version
CROSS JOIN (
  VALUES ('billing:read'), ('billing:write'), ('catalog:write')
) AS scope(scope)
WHERE NOT EXISTS (
  SELECT 1
  FROM "oauth_scope" AS existing
  WHERE existing."catalog_version_id" = version."id"
    AND existing."scope" = scope.scope
);

INSERT INTO "session_scope_grant" ("id", "catalog_version_id", "role", "scope", "created_at")
SELECT gen_random_uuid(), version."id", 'staff', scope.scope, CURRENT_TIMESTAMP
FROM "catalog_version" AS version
CROSS JOIN (
  VALUES ('billing:read'), ('billing:write'), ('catalog:write')
) AS scope(scope)
WHERE NOT EXISTS (
  SELECT 1
  FROM "session_scope_grant" AS existing
  WHERE existing."catalog_version_id" = version."id"
    AND existing."role" = 'staff'
    AND existing."scope" = scope.scope
);

INSERT INTO "session_scope_grant" ("id", "catalog_version_id", "role", "scope", "created_at")
SELECT gen_random_uuid(), version."id", 'client', 'billing:read', CURRENT_TIMESTAMP
FROM "catalog_version" AS version
WHERE NOT EXISTS (
  SELECT 1
  FROM "session_scope_grant" AS existing
  WHERE existing."catalog_version_id" = version."id"
    AND existing."role" = 'client'
    AND existing."scope" = 'billing:read'
);
