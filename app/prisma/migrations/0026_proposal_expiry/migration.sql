-- Proposal expiry. Every value is a row in proposal_expiry_config, not code.
CREATE TABLE "proposal_expiry_config" (
    "id" UUID NOT NULL,
    "default_valid_days" INTEGER NOT NULL,
    "near_expiry_days" INTEGER NOT NULL,
    "extend_default_days" INTEGER NOT NULL,
    "extend_max_days" INTEGER NOT NULL,
    "label_active" TEXT NOT NULL,
    "label_expiring" TEXT NOT NULL,
    "label_expired" TEXT NOT NULL,
    "expired_message" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proposal_expiry_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_expiry_config_days_check" CHECK ("default_valid_days" > 0 AND "near_expiry_days" >= 0 AND "extend_default_days" > 0 AND "extend_max_days" >= "extend_default_days")
);

INSERT INTO "proposal_expiry_config" ("id", "default_valid_days", "near_expiry_days", "extend_default_days", "extend_max_days", "label_active", "label_expiring", "label_expired", "expired_message")
VALUES ('00000000-0000-4000-8000-0000000000e1', 30, 7, 14, 90, 'Open', 'Expires soon', 'Expired', 'This proposal has expired. Ask us to extend it before accepting.')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Proposal" ADD COLUMN "valid_until" TIMESTAMP(3);
CREATE INDEX "Proposal_valid_until_idx" ON "Proposal"("valid_until");

-- New proposals get valid_until = created + default_valid_days from the config row.
CREATE OR REPLACE FUNCTION "proposal_set_valid_until"() RETURNS trigger AS $$
BEGIN
  IF NEW."valid_until" IS NULL THEN
    NEW."valid_until" := COALESCE(NEW."createdAt", CURRENT_TIMESTAMP)
      + make_interval(days => (SELECT "default_valid_days" FROM "proposal_expiry_config" ORDER BY "id" LIMIT 1));
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "proposal_set_valid_until" BEFORE INSERT ON "Proposal"
FOR EACH ROW EXECUTE FUNCTION "proposal_set_valid_until"();

-- Open proposals that already exist start their window today, so the deploy expires nothing.
UPDATE "Proposal" SET "valid_until" = CURRENT_TIMESTAMP + make_interval(days => (SELECT "default_valid_days" FROM "proposal_expiry_config" ORDER BY "id" LIMIT 1))
WHERE "valid_until" IS NULL AND "status" <> 'closed';
