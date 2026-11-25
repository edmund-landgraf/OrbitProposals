-- PricingModel is the discriminator. pricing JSON carries the amount (and hours for Capped Hours).
-- Published packages: Workflow Check $250, Capped Hours 4 $550, Capped Hours 8 $900, Fixed Price at least $3,000.
-- A missing price uses that package. An existing price is kept, then clamped to the schema cap ($175 x hours) or floor ($3,000).
CREATE TYPE "PricingModel" AS ENUM ('workflow_check', 'capped_hours', 'fixed_price');

ALTER TABLE "Proposal" ADD COLUMN "pricingModel" "PricingModel";
ALTER TABLE "Proposal" ADD COLUMN "pricing" JSONB;

UPDATE "Proposal" SET
  "pricingModel" = CASE "engagement"::text
    WHEN 'workflow_check' THEN 'workflow_check'::"PricingModel"
    WHEN 'capped_hours_4' THEN 'capped_hours'::"PricingModel"
    WHEN 'capped_hours_8' THEN 'capped_hours'::"PricingModel"
    ELSE 'fixed_price'::"PricingModel"
  END,
  "pricing" = CASE "engagement"::text
    WHEN 'workflow_check' THEN jsonb_build_object('model', 'workflow_check', 'amountMinor', 25000, 'currency', 'USD')
    WHEN 'capped_hours_4' THEN jsonb_build_object(
      'model', 'capped_hours',
      'hours', 4,
      'amountMinor', LEAST(COALESCE("priceAmountMinor", 55000), 70000),
      'currency', 'USD'
    )
    WHEN 'capped_hours_8' THEN jsonb_build_object(
      'model', 'capped_hours',
      'hours', 8,
      'amountMinor', LEAST(COALESCE("priceAmountMinor", 90000), 140000),
      'currency', 'USD'
    )
    ELSE jsonb_build_object(
      'model', 'fixed_price',
      'amountMinor', GREATEST(COALESCE("priceAmountMinor", 300000), 300000),
      'currency', 'USD'
    )
  END;

ALTER TABLE "Proposal" ALTER COLUMN "pricingModel" SET NOT NULL;
ALTER TABLE "Proposal" ALTER COLUMN "pricing" SET NOT NULL;
ALTER TABLE "Proposal" DROP COLUMN "budget";
ALTER TABLE "Proposal" DROP COLUMN "priceAmountMinor";
ALTER TABLE "Proposal" DROP COLUMN "priceCurrency";
