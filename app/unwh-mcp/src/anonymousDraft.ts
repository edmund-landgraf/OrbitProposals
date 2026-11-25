import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CAPPED_HOURS_4_AMOUNT_MINOR, CAPPED_HOURS_8_AMOUNT_MINOR, ENGAGEMENT_KINDS, FIXED_PRICE_FLOOR_MINOR, HOURLY_RATE_AMOUNT_MINOR, StoredEngagementPricingSchema, StoredPricingSchema, WORKFLOW_CHECK_AMOUNT_MINOR, pricing as publishedPricing } from "../../packages/shapes/src/pricing.js";

// An anonymous draft is never stored: the tool validates the fields and hands the draft back to the caller.
// Nothing is written to the database, so no other caller can list or read it, and nothing personal is kept.
// To save it, the caller signs in and passes the same fields to unw_create_proposal.

const EMAIL = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const PHONE = /\d(?:[\s().-]{0,2}\d){9,}/;

export function containsContactDetails(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return EMAIL.test(text) || PHONE.test(text);
}

type DraftWarning = { code: string; message: string; path?: string };
const addWeeks = (date: string, weeks: number) => { const value = new Date(`${date}T00:00:00.000Z`); value.setUTCDate(value.getUTCDate() + weeks * 7); return value.toISOString().slice(0, 10); };
const dollars = (amountMinor: number) => `$${(amountMinor / 100).toLocaleString("en-US")}`;

/**
 * Checks the save would fail or warn on, without a database: the published catalog prices (the API re-checks the active
 * catalog on save), and dates that cannot happen.
 */
export function draftWarnings(input: { pricing?: { model: string; amountMinor?: number; rateMinor?: number; hours?: number; currency: string }; timeline: { startDate: string | null; targetDate: string | null; milestones: Array<{ title: string; dueDate?: string | null; weekOffset?: number; weeksLow?: number; weeksHigh?: number }> } }): DraftWarning[] {
  const warnings: DraftWarning[] = [];
  const price = input.pricing;
  if (price) {
    if (price.currency !== publishedPricing.currency) warnings.push({ code: "CATALOG_CURRENCY", message: `The published catalog is in ${publishedPricing.currency}; ${price.currency} will be rejected on save.`, path: "pricing.currency" });
    if (price.model === "fixed_price" && typeof price.amountMinor === "number" && price.amountMinor < FIXED_PRICE_FLOOR_MINOR) warnings.push({ code: "CATALOG_FLOOR", message: `Fixed Price starts at ${dollars(FIXED_PRICE_FLOOR_MINOR)} (amountMinor ${FIXED_PRICE_FLOOR_MINOR}); ${dollars(price.amountMinor)} is under the floor and will be rejected on save.`, path: "pricing.amountMinor" });
    if (price.model === "workflow_check" && price.amountMinor !== WORKFLOW_CHECK_AMOUNT_MINOR) warnings.push({ code: "CATALOG_PRICE", message: `Workflow Check is exactly ${dollars(WORKFLOW_CHECK_AMOUNT_MINOR)} (amountMinor ${WORKFLOW_CHECK_AMOUNT_MINOR}).`, path: "pricing.amountMinor" });
    if (price.model === "hourly" && price.rateMinor !== HOURLY_RATE_AMOUNT_MINOR) warnings.push({ code: "CATALOG_PRICE", message: `The hourly rate is exactly ${dollars(HOURLY_RATE_AMOUNT_MINOR)}/hr (rateMinor ${HOURLY_RATE_AMOUNT_MINOR}).`, path: "pricing.rateMinor" });
    if (price.model === "capped_hours" && !((price.hours === publishedPricing.capped4.hours && price.amountMinor === CAPPED_HOURS_4_AMOUNT_MINOR) || (price.hours === publishedPricing.capped8.hours && price.amountMinor === CAPPED_HOURS_8_AMOUNT_MINOR))) warnings.push({ code: "CATALOG_PRICE", message: `Capped Hours is ${publishedPricing.capped4.hours} hours for ${dollars(CAPPED_HOURS_4_AMOUNT_MINOR)} or ${publishedPricing.capped8.hours} hours for ${dollars(CAPPED_HOURS_8_AMOUNT_MINOR)}.`, path: "pricing" });
  }
  const { startDate, targetDate, milestones } = input.timeline;
  if (startDate && targetDate && targetDate < startDate) warnings.push({ code: "TIMELINE_TARGET_BEFORE_START", message: `The target date ${targetDate} is before the start date ${startDate}.`, path: "timeline.targetDate" });
  milestones.forEach((milestone, index) => {
    const path = `timeline.milestones.${index}`;
    if (milestone.dueDate === undefined && milestone.weekOffset === undefined && milestone.weeksLow === undefined && milestone.weeksHigh === undefined) warnings.push({ code: "MILESTONE_DATE_MISSING", message: `Milestone "${milestone.title}" needs a dueDate, a weekOffset, or a week estimate before it can be saved.`, path });
    if (milestone.weekOffset !== undefined && !startDate && !milestone.dueDate) warnings.push({ code: "MILESTONE_WEEK_OFFSET_UNRESOLVED", message: `Milestone "${milestone.title}" has a week offset but no start date, so it has no due date yet.`, path });
    const due = milestone.dueDate ?? (milestone.weekOffset !== undefined && startDate ? addWeeks(startDate, milestone.weekOffset) : null);
    if (due && startDate && due < startDate) warnings.push({ code: "MILESTONE_BEFORE_START", message: `Milestone "${milestone.title}" is due ${due}, before the start date ${startDate}.`, path: `${path}.dueDate` });
  });
  return warnings;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

export function registerDraftProposal(server: McpServer) {
  server.registerTool("unw_draft_proposal", {
    description: "Checks a proposal shape without saving it. Nothing is stored, and no one else can see it. Use this while still chatting. Do not include names, email addresses, or phone numbers. Pricing is optional and must come from the published catalog (unw_get_catalog); never invent hours or prices. Ask the client before saving. Only after they agree, sign in and pass the same fields to unw_create_proposal.",
    inputSchema: {
      title: z.string().min(1).max(300),
      engagement: z.enum(ENGAGEMENT_KINDS).optional(),
      scope: z.object({
        summary: z.string().min(1).max(4000),
        deliverables: z.array(z.string().min(1).max(500)).max(50).default([]),
        assumptions: z.array(z.string().max(500)).max(50).default([]),
        exclusions: z.array(z.string().max(500)).max(50).default([]),
      }).strict(),
      // Same timeline shape as unw_create_proposal, so a draft can be saved without reshaping it.
      timeline: z.object({
        startDate: z.string().date().nullable().default(null),
        targetDate: z.string().date().nullable().default(null),
        milestones: z.array(z.object({
          title: z.string().min(1).max(300),
          description: z.string().max(2000).default(""),
          dueDate: z.string().date().nullable().optional(),
          weekOffset: z.number().int().min(0).max(520).optional(),
          weeksLow: z.number().int().min(1).max(104).optional(),
          weeksHigh: z.number().int().min(1).max(104).optional(),
          gate: z.string().max(500).optional(),
          actualStart: z.string().date().nullable().optional(),
          actualEnd: z.string().date().nullable().optional(),
        }).strict()).max(50).default([]),
      }).strict().default({ startDate: null, targetDate: null, milestones: [] }),
      pricing: StoredPricingSchema.optional(),
    },
    outputSchema: { ok: z.boolean(), entity: z.unknown(), warnings: z.array(z.unknown()) },
    annotations: READ_ONLY,
  }, async (input) => {
    if (containsContactDetails({ title: input.title, scope: input.scope })) {
      return { isError: true, content: [{ type: "text" as const, text: "Leave names, email addresses, and phone numbers out of a draft. You can add contact details after signing in." }] };
    }
    if (input.pricing && !input.engagement) {
      return { isError: true, content: [{ type: "text" as const, text: "Choose an engagement before adding pricing." }] };
    }
    if (input.pricing && input.engagement) {
      const paired = StoredEngagementPricingSchema.safeParse({ engagement: input.engagement, pricing: input.pricing });
      if (!paired.success) return { isError: true, content: [{ type: "text" as const, text: paired.error.issues.map((issue) => issue.message).join(" ") }] };
    }
    const missing = [
      ...(input.engagement ? [] : ["engagement"]),
      ...(input.scope.deliverables.length > 0 ? [] : ["scope.deliverables"]),
      ...(input.pricing ? [] : ["pricing"]),
    ];
    const result = {
      ok: true,
      entity: { draft: input, saved: false, missing, nextStep: "Sign in to Unwhelm, then call unw_create_proposal with this draft to save it. The API checks pricing against the published catalog when it is saved." },
      warnings: draftWarnings(input) as unknown[],
    };
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
  });
}
