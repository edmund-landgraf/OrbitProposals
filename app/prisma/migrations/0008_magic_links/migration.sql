CREATE TABLE "MagicLink" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "MagicLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MagicLink_tokenHash_key" ON "MagicLink"("tokenHash");
CREATE INDEX "MagicLink_email_expiresAt_idx" ON "MagicLink"("email", "expiresAt");
CREATE INDEX "MagicLink_expiresAt_idx" ON "MagicLink"("expiresAt");
