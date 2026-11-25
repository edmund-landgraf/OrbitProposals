-- Staff-only OAuth scopes: hidden from discovery and stripped from non-staff connector (DCR) tokens.
ALTER TABLE "oauth_scope" ADD COLUMN "staff_only" BOOLEAN NOT NULL DEFAULT false;
UPDATE "oauth_scope" SET "staff_only" = true WHERE "scope" IN ('admin', 'catalog:write');

-- Narrow the client token preset to what client flows need. Existing tokens keep the scopes they were minted with.
UPDATE "scope_preset" SET "scopes" = ARRAY['proposals:read', 'proposals:write', 'billing:read', 'projects:read'] WHERE "code" = 'client';
