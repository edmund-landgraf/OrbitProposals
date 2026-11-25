-- Payment terms and retainage are editable rows. A contract keeps the term and percent copied at acceptance.

ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'overdue';

CREATE TABLE "payment_term" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    CONSTRAINT "payment_term_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_term_days_check" CHECK ("days" >= 0)
);

CREATE UNIQUE INDEX "payment_term_code_key" ON "payment_term"("code");

INSERT INTO "payment_term" ("id", "code", "label", "days", "is_default", "sort_order") VALUES
    ('00000000-0000-4000-8000-0000000000b1', 'due_on_receipt', 'Due on receipt', 0, false, 10),
    ('00000000-0000-4000-8000-0000000000b2', 'net_15', 'Net 15', 15, false, 20),
    ('00000000-0000-4000-8000-0000000000b3', 'net_30', 'Net 30', 30, true, 30)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "retainage_default" (
    "id" UUID NOT NULL,
    "percent_basis" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "retainage_default_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "retainage_default_percent_check" CHECK ("percent_basis" >= 0 AND "percent_basis" <= 1000000)
);

INSERT INTO "retainage_default" ("id", "percent_basis", "label") VALUES
    ('00000000-0000-4000-8000-0000000000b4', 100000, 'Retainage 10%')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Contract" ADD COLUMN "payment_term_id" UUID;
ALTER TABLE "Contract" ADD COLUMN "retainage_percent_basis" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contract" ADD COLUMN "retainage_held_minor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_term"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contract_payment_term_id_idx" ON "Contract"("payment_term_id");

ALTER TABLE "Invoice" ADD COLUMN "gross_minor" INTEGER;
ALTER TABLE "Invoice" ADD COLUMN "retainage_minor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'standard';
