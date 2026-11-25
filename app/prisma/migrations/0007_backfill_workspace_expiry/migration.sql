UPDATE "ChatSession"
SET "expiresAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP) + INTERVAL '30 days'
WHERE "ownerId" IS NULL AND "expiresAt" IS NULL;

UPDATE "ProposalPublicLink"
SET "expiresAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) + INTERVAL '30 days'
WHERE "expiresAt" IS NULL;
