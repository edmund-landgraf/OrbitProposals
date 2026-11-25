import { z } from "zod";

/** Dollars published on the site and enforced by proposal validation. */
export const pricing = {
  currency: "USD" as const,
  hourlyRate: 175,
  workflowCheck: 250,
  workflowCheckMinutes: 180,
  workflowCheckCreditDays: 30,
  capped4: { hours: 4, price: 550 },
  capped8: { hours: 8, price: 900 },
  fixedFrom: "$3K",
  fixedFromDollars: 3_000,
  freeConsultMinutes: 30,
} as const;

const toMinor = (dollars: number) => dollars * 100;

export const WORKFLOW_CHECK_AMOUNT_MINOR = toMinor(pricing.workflowCheck);
export const HOURLY_RATE_AMOUNT_MINOR = toMinor(pricing.hourlyRate);
export const CAPPED_HOURS_4_AMOUNT_MINOR = toMinor(pricing.capped4.price);
export const CAPPED_HOURS_8_AMOUNT_MINOR = toMinor(pricing.capped8.price);
export const FIXED_PRICE_FLOOR_MINOR = toMinor(pricing.fixedFromDollars);
/** Published capped prices are exact. These names remain for older imports. */
export const CAPPED_HOURS_4_FLOOR_MINOR = CAPPED_HOURS_4_AMOUNT_MINOR;
export const CAPPED_HOURS_8_FLOOR_MINOR = CAPPED_HOURS_8_AMOUNT_MINOR;

export const ENGAGEMENT_KINDS = ["workflow_check", "capped_hours_4", "capped_hours_8", "fixed_price", "hourly"] as const;
export const PRICING_MODELS = ["workflow_check", "capped_hours", "fixed_price", "hourly"] as const;

export const SINGLE_PRICING_MODEL_MESSAGE = "A proposal has exactly one pricing model, and the engagement must match it.";

export const EngagementKindSchema = z.enum(ENGAGEMENT_KINDS);
export const PricingModelSchema = z.enum(PRICING_MODELS);

const usd = z.literal(pricing.currency);

export const PricingSchema = z.discriminatedUnion("model", [
  z.object({
    model: z.literal("workflow_check"),
    amountMinor: z.literal(WORKFLOW_CHECK_AMOUNT_MINOR),
    currency: usd,
  }).strict(),
  z.object({
    model: z.literal("capped_hours"),
    hours: z.union([z.literal(pricing.capped4.hours), z.literal(pricing.capped8.hours)]),
    amountMinor: z.number().int(),
    currency: usd,
  }).strict().refine(
    (value) => value.hours === pricing.capped4.hours
      ? value.amountMinor === CAPPED_HOURS_4_AMOUNT_MINOR
      : value.amountMinor === CAPPED_HOURS_8_AMOUNT_MINOR,
    `Capped Hours must be exactly ${pricing.capped4.hours} hours at ${CAPPED_HOURS_4_AMOUNT_MINOR} cents or ${pricing.capped8.hours} hours at ${CAPPED_HOURS_8_AMOUNT_MINOR} cents.`,
  ),
  z.object({
    model: z.literal("fixed_price"),
    amountMinor: z.number().int().min(FIXED_PRICE_FLOOR_MINOR),
    currency: usd,
  }).strict(),
  z.object({
    model: z.literal("hourly"),
    rateMinor: z.literal(HOURLY_RATE_AMOUNT_MINOR),
    currency: usd,
  }).strict(),
]);

export type EngagementKind = z.infer<typeof EngagementKindSchema>;
export type PricingModel = z.infer<typeof PricingModelSchema>;
export type ProposalPricing = z.infer<typeof PricingSchema>;

export function engagementMatchesPricing(engagement: EngagementKind, price: ProposalPricing): boolean {
  if (engagement === "workflow_check") return price.model === "workflow_check";
  if (engagement === "capped_hours_4") return price.model === "capped_hours" && price.hours === pricing.capped4.hours;
  if (engagement === "capped_hours_8") return price.model === "capped_hours" && price.hours === pricing.capped8.hours;
  if (engagement === "fixed_price") return price.model === "fixed_price";
  if (engagement === "hourly") return price.model === "hourly";
  return false;
}

export const EngagementPricingSchema = z.object({
  engagement: EngagementKindSchema,
  pricing: PricingSchema,
}).strict().superRefine((value, ctx) => {
  if (!engagementMatchesPricing(value.engagement, value.pricing)) {
    ctx.addIssue({ code: "custom", path: ["pricing"], message: SINGLE_PRICING_MODEL_MESSAGE });
  }
});

const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** Shape of a price already accepted by a catalog version. Amounts are not the seed literals. */
export const StoredPricingSchema = z.discriminatedUnion("model", [
  z.object({ model: z.literal("workflow_check"), amountMinor: z.number().int().nonnegative(), currency: currencyCode }).strict(),
  z.object({ model: z.literal("capped_hours"), hours: z.number().int().positive(), amountMinor: z.number().int().nonnegative(), currency: currencyCode }).strict(),
  z.object({ model: z.literal("fixed_price"), amountMinor: z.number().int().nonnegative(), currency: currencyCode }).strict(),
  z.object({ model: z.literal("hourly"), rateMinor: z.number().int().nonnegative(), currency: currencyCode }).strict(),
]);

export type StoredPricing = z.infer<typeof StoredPricingSchema>;

export function engagementMatchesStoredPricing(engagement: EngagementKind, price: StoredPricing): boolean {
  if (engagement === "workflow_check") return price.model === "workflow_check";
  if (engagement === "capped_hours_4") return price.model === "capped_hours" && price.hours === pricing.capped4.hours;
  if (engagement === "capped_hours_8") return price.model === "capped_hours" && price.hours === pricing.capped8.hours;
  if (engagement === "fixed_price") return price.model === "fixed_price";
  if (engagement === "hourly") return price.model === "hourly";
  return false;
}

/**
 * A copy whose engagement changed has no amount until staff price it (proposalDuplicate.duplicatePricing).
 * Reads must accept it; writes through unw_create_proposal still require a full StoredPricingSchema price.
 */
export const PendingStaffPricingSchema = z.object({
  model: PricingModelSchema,
  currency: currencyCode.optional(),
  pendingStaffPrice: z.literal(true),
  message: z.string().optional(),
}).strict();
export type PendingStaffPricing = z.infer<typeof PendingStaffPricingSchema>;

/** Pricing as returned on a proposal document: a catalog price, or a pending staff price. */
export const ProposalDocumentPricingSchema = z.union([StoredPricingSchema, PendingStaffPricingSchema]);
export type ProposalDocumentPricing = z.infer<typeof ProposalDocumentPricingSchema>;

export const isPendingStaffPricing = (price: unknown): price is PendingStaffPricing =>
  !!price && typeof price === "object" && (price as { pendingStaffPrice?: unknown }).pendingStaffPrice === true;

const ENGAGEMENT_MODEL: Record<EngagementKind, PricingModel> = { workflow_check: "workflow_check", capped_hours_4: "capped_hours", capped_hours_8: "capped_hours", fixed_price: "fixed_price", hourly: "hourly" };

export function engagementMatchesDocumentPricing(engagement: EngagementKind, price: ProposalDocumentPricing): boolean {
  if (isPendingStaffPricing(price)) return ENGAGEMENT_MODEL[engagement] === price.model;
  return engagementMatchesStoredPricing(engagement, price as StoredPricing);
}

export const StoredEngagementPricingSchema = z.object({
  engagement: EngagementKindSchema,
  pricing: StoredPricingSchema,
}).strict().superRefine((value, ctx) => {
  if (!engagementMatchesStoredPricing(value.engagement, value.pricing)) {
    ctx.addIssue({ code: "custom", path: ["pricing"], message: SINGLE_PRICING_MODEL_MESSAGE });
  }
});

export type PublicPricingPlan = {
  id: EngagementKind;
  name: string;
  engagement: EngagementKind;
  model: PricingModel;
  price: { amountMinor: number; currency: typeof pricing.currency };
  hours: number | null;
  priceKind: "exact" | "minimum" | "rate";
};

/** Catalog returned by GET /public/pricing and suitable for the site to display. */
export function publicPricingPlans(): { currency: typeof pricing.currency; plans: PublicPricingPlan[] } {
  return {
    currency: pricing.currency,
    plans: [
      {
        id: "workflow_check",
        name: "Workflow Check",
        engagement: "workflow_check",
        model: "workflow_check",
        price: { amountMinor: WORKFLOW_CHECK_AMOUNT_MINOR, currency: pricing.currency },
        hours: null,
        priceKind: "exact",
      },
      {
        id: "capped_hours_4",
        name: "Capped Hours, 4",
        engagement: "capped_hours_4",
        model: "capped_hours",
        price: { amountMinor: CAPPED_HOURS_4_AMOUNT_MINOR, currency: pricing.currency },
        hours: pricing.capped4.hours,
        priceKind: "exact",
      },
      {
        id: "capped_hours_8",
        name: "Capped Hours, 8",
        engagement: "capped_hours_8",
        model: "capped_hours",
        price: { amountMinor: CAPPED_HOURS_8_AMOUNT_MINOR, currency: pricing.currency },
        hours: pricing.capped8.hours,
        priceKind: "exact",
      },
      {
        id: "fixed_price",
        name: "Fixed Price",
        engagement: "fixed_price",
        model: "fixed_price",
        price: { amountMinor: FIXED_PRICE_FLOOR_MINOR, currency: pricing.currency },
        hours: null,
        priceKind: "minimum",
      },
      {
        id: "hourly",
        name: "Hourly",
        engagement: "hourly",
        model: "hourly",
        price: { amountMinor: HOURLY_RATE_AMOUNT_MINOR, currency: pricing.currency },
        hours: null,
        priceKind: "rate",
      },
    ],
  };
}
