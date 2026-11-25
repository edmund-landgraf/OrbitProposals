-- SignWell (test-mode) / provider-neutral e-signature integration.
-- Stores provider request ids and immutable signed artifacts (signed PDF + audit trail/certificate).

CREATE TABLE "contract_esign_request" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "proposal_version_id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_document_id" TEXT NOT NULL,
  "unique_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'created',
  "provider_status" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "test_mode" BOOLEAN NOT NULL DEFAULT TRUE,
  "completed_at" TIMESTAMPTZ,
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "contract_esign_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_esign_request_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "contract_esign_request_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contract_esign_request_unique_key_key" ON "contract_esign_request"("unique_key");
CREATE UNIQUE INDEX "contract_esign_request_contract_id_proposal_version_id_key" ON "contract_esign_request"("contract_id", "proposal_version_id");
CREATE INDEX "contract_esign_request_provider_provider_document_id_idx" ON "contract_esign_request"("provider", "provider_document_id");
CREATE INDEX "contract_esign_request_status_updated_at_idx" ON "contract_esign_request"("status", "updated_at");

CREATE TABLE "contract_esign_artifact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "bytes" BYTEA NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "contract_esign_artifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_esign_artifact_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "contract_esign_request"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contract_esign_artifact_request_id_kind_key" ON "contract_esign_artifact"("request_id", "kind");
CREATE INDEX "contract_esign_artifact_request_id_created_at_idx" ON "contract_esign_artifact"("request_id", "created_at");

-- Ensure updated_at stays current on updates (matches existing convention where needed).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contract_esign_request_set_updated_at ON "contract_esign_request";
CREATE TRIGGER contract_esign_request_set_updated_at
BEFORE UPDATE ON "contract_esign_request"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

