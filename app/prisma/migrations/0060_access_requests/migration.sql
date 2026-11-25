-- Public preview access requests, plus a user-level suspension timestamp.
-- Approval uses UNWH_TRIAL_ORG_ID at runtime; this migration does not attach anyone to an organization.

ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);

CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "AccessRequest" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "role" TEXT,
    "reason" TEXT NOT NULL,
    "referral" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccessRequest_email_status_idx" ON "AccessRequest"("email", "status");
CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");
