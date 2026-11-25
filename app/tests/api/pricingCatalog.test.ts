import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPPED_HOURS_4_AMOUNT_MINOR,
  CAPPED_HOURS_8_AMOUNT_MINOR,
  EngagementPricingSchema,
  FIXED_PRICE_FLOOR_MINOR,
  HOURLY_RATE_AMOUNT_MINOR,
  PricingSchema,
  SINGLE_PRICING_MODEL_MESSAGE,
  WORKFLOW_CHECK_AMOUNT_MINOR,
  publicPricingPlans,
} from "../../packages/shapes/src/pricing.js";

const usd = "USD" as const;

test("published prices are the site's advertised amounts", () => {
  const catalog = publicPricingPlans();
  assert.equal(catalog.plans.length, 5);
  assert.deepEqual(catalog.plans.map((plan) => [plan.id, plan.price.amountMinor, plan.priceKind, plan.hours]), [
    ["workflow_check", WORKFLOW_CHECK_AMOUNT_MINOR, "exact", null],
    ["capped_hours_4", CAPPED_HOURS_4_AMOUNT_MINOR, "exact", 4],
    ["capped_hours_8", CAPPED_HOURS_8_AMOUNT_MINOR, "exact", 8],
    ["fixed_price", FIXED_PRICE_FLOOR_MINOR, "minimum", null],
    ["hourly", HOURLY_RATE_AMOUNT_MINOR, "rate", null],
  ]);
  assert.equal(WORKFLOW_CHECK_AMOUNT_MINOR, 25_000);
  assert.equal(CAPPED_HOURS_4_AMOUNT_MINOR, 55_000);
  assert.equal(CAPPED_HOURS_8_AMOUNT_MINOR, 90_000);
  assert.equal(FIXED_PRICE_FLOOR_MINOR, 300_000);
  assert.equal(HOURLY_RATE_AMOUNT_MINOR, 17_500);
});

test("a proposal accepts exactly one published pricing model", () => {
  assert.equal(PricingSchema.safeParse({ model: "workflow_check", amountMinor: 25_000, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "workflow_check", amountMinor: 0, currency: usd }).success, false);
  assert.equal(PricingSchema.safeParse({ model: "workflow_check", amountMinor: 25_001, currency: usd }).success, false);

  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 4, amountMinor: 55_000, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 8, amountMinor: 90_000, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 4, amountMinor: 54_999, currency: usd }).success, false);
  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 4, amountMinor: 70_000, currency: usd }).success, false);
  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 6, amountMinor: 55_000, currency: usd }).success, false);
  assert.equal(PricingSchema.safeParse({ model: "capped_hours", hours: 8, amountMinor: 55_000, currency: usd }).success, false);

  assert.equal(PricingSchema.safeParse({ model: "fixed_price", amountMinor: 300_000, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "fixed_price", amountMinor: 450_000, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "fixed_price", amountMinor: 299_999, currency: usd }).success, false);

  assert.equal(PricingSchema.safeParse({ model: "hourly", rateMinor: 17_500, currency: usd }).success, true);
  assert.equal(PricingSchema.safeParse({ model: "hourly", rateMinor: 17_000, currency: usd }).success, false);
  assert.equal(PricingSchema.safeParse({ model: "hourly", amountMinor: 17_500, currency: usd }).success, false);

  assert.equal(PricingSchema.safeParse([
    { model: "workflow_check", amountMinor: 25_000, currency: usd },
    { model: "fixed_price", amountMinor: 300_000, currency: usd },
  ]).success, false);
  assert.equal(PricingSchema.safeParse({
    model: "fixed_price",
    amountMinor: 300_000,
    currency: usd,
    rateMinor: 17_500,
  }).success, false);
});

test("engagement must be the same single pricing model", () => {
  const accept = (engagement: string, pricing: unknown) => EngagementPricingSchema.safeParse({ engagement, pricing });
  assert.equal(accept("workflow_check", { model: "workflow_check", amountMinor: 25_000, currency: usd }).success, true);
  assert.equal(accept("capped_hours_4", { model: "capped_hours", hours: 4, amountMinor: 55_000, currency: usd }).success, true);
  assert.equal(accept("capped_hours_8", { model: "capped_hours", hours: 8, amountMinor: 90_000, currency: usd }).success, true);
  assert.equal(accept("fixed_price", { model: "fixed_price", amountMinor: 300_000, currency: usd }).success, true);
  assert.equal(accept("hourly", { model: "hourly", rateMinor: 17_500, currency: usd }).success, true);

  const swapped = accept("capped_hours_4", { model: "capped_hours", hours: 8, amountMinor: 90_000, currency: usd });
  assert.equal(swapped.success, false);
  assert.match(swapped.error?.issues[0]?.message ?? "", new RegExp(SINGLE_PRICING_MODEL_MESSAGE));

  const secondModel = accept("hourly", { model: "fixed_price", amountMinor: 300_000, currency: usd });
  assert.equal(secondModel.success, false);
  assert.match(secondModel.error?.issues[0]?.message ?? "", new RegExp(SINGLE_PRICING_MODEL_MESSAGE));
});
