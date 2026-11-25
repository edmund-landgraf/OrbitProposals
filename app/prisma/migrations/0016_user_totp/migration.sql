-- TOTP enrollment for admin accounts. Enforcement stays behind UNWH_ADMIN_MFA.

ALTER TABLE "User" ADD COLUMN "totpSecretEnc" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "totpRecoveryHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
