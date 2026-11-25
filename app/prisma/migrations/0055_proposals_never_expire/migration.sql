-- Proposals do not expire.
-- The insert trigger from 0026 stamped valid_until = created + default_valid_days
-- (30 days). Drop it so new rows keep valid_until NULL, and clear every stored
-- deadline. The column and proposal_expiry_config stay so older reads still
-- parse; the application ignores any date that remains.
-- Magic links, OAuth codes, public share links, and Try me sandboxes are unchanged.

DROP TRIGGER IF EXISTS "proposal_set_valid_until" ON "Proposal";
DROP FUNCTION IF EXISTS "proposal_set_valid_until"();

UPDATE "Proposal" SET "valid_until" = NULL WHERE "valid_until" IS NOT NULL;
