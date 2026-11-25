import type { InvoiceStatus } from "@prisma/client";
import { z } from "zod";
import { MCP_SCOPES } from "../shared/mcpScopes.js";
import {
  BillingScheduleError,
  basisToPercent,
  milestoneThatOwnsUnscopedEntries,
  reconcileBillingSchedule,
  type BillingScheduleDraft,
  type BillingTriggerName,
  type MilestoneBillingTarget,
  type ProposalPricing,
} from "../packages/shapes/src/index.js";
import {
  CAPPED_HOURS_4_AMOUNT_MINOR,
  CAPPED_HOURS_8_AMOUNT_MINOR,
  FIXED_PRICE_FLOOR_MINOR,
  HOURLY_RATE_AMOUNT_MINOR,
  WORKFLOW_CHECK_AMOUNT_MINOR,
  pricing,
} from "../packages/shapes/src/pricing.js";

export const CATALOG_V1_ID = "00000000-0000-4000-8000-000000000001";

export type CatalogTier = {
  code: string;
  model: "workflow_check" | "capped_hours" | "fixed_price" | "hourly";
  amountMinor: number;
  hours: number | null;
  minAmountMinor: number | null;
  currency: string;
};

export type CatalogLine = {
  sortOrder: number;
  label: string;
  trigger: BillingTriggerName;
  percentBasis: number;
  amountMinor: number | null;
  amountRule: "percent_of_total" | "zero";
  dueOffsetDays: number | null;
};

export type CatalogTemplate = {
  id: string;
  model: CatalogTier["model"];
  percentBasis: number;
  leftoverCentTarget: "last_entry";
  lines: CatalogLine[];
};

export type ActiveCatalog = {
  id: string;
  updatedAt: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  tiers: CatalogTier[];
  templates: CatalogTemplate[];
  invoicePolicy: {
    signingDueOffsetDays: number;
    milestoneDueOffsetDays: number;
    preferMilestoneDueDate: boolean;
    initialStatus: InvoiceStatus;
    unscopedRemainderRule: "sole_or_final_milestone";
    retainagePolicy: "add_on_accept";
    invoiceOnSign: boolean;
  };
  transitions: Array<{ fromStatus: InvoiceStatus; toStatus: InvoiceStatus; staffOnly: boolean }>;
  mcpScopes: string[];
  /** MCP scopes only staff or admins may hold (oauth_scope.staff_only). Hidden from discovery and stripped from client connector tokens. */
  staffOnlyScopes?: string[];
  grants: Array<{ role: string; scope: string }>;
};

let cached: { id: string; updatedAt: string; catalog: ActiveCatalog } | null = null;

export function invalidateCatalogCache(): void {
  cached = null;
}

/** Values written by 0014. Used only when a test double has no catalog tables. */
export function seedCatalogFixture(): ActiveCatalog {
  const tier = (code: string, model: CatalogTier["model"], amountMinor: number, hours: number | null, minAmountMinor: number): CatalogTier => ({
    code, model, amountMinor, hours, minAmountMinor, currency: pricing.currency,
  });
  const line = (sortOrder: number, label: string, trigger: BillingTriggerName, percentBasis: number, amountRule: CatalogLine["amountRule"], amountMinor: number | null): CatalogLine => ({
    sortOrder, label, trigger, percentBasis, amountMinor, amountRule, dueOffsetDays: null,
  });
  return {
    id: CATALOG_V1_ID,
    updatedAt: "2026-01-01T00:00:00.000Z",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    tiers: [
      tier("workflow_check", "workflow_check", WORKFLOW_CHECK_AMOUNT_MINOR, 3, WORKFLOW_CHECK_AMOUNT_MINOR),
      tier("capped_hours_4", "capped_hours", CAPPED_HOURS_4_AMOUNT_MINOR, pricing.capped4.hours, CAPPED_HOURS_4_AMOUNT_MINOR),
      tier("capped_hours_8", "capped_hours", CAPPED_HOURS_8_AMOUNT_MINOR, pricing.capped8.hours, CAPPED_HOURS_8_AMOUNT_MINOR),
      tier("fixed_price", "fixed_price", FIXED_PRICE_FLOOR_MINOR, null, FIXED_PRICE_FLOOR_MINOR),
      tier("hourly", "hourly", HOURLY_RATE_AMOUNT_MINOR, null, HOURLY_RATE_AMOUNT_MINOR),
    ],
    templates: [
      { id: "00000000-0000-4000-8000-000000000031", model: "workflow_check", percentBasis: 1_000_000, leftoverCentTarget: "last_entry", lines: [line(1, "Workflow Check", "contract_signed", 1_000_000, "percent_of_total", null)] },
      { id: "00000000-0000-4000-8000-000000000032", model: "capped_hours", percentBasis: 1_000_000, leftoverCentTarget: "last_entry", lines: [line(1, "Capped Hours, {hours} hours", "contract_signed", 1_000_000, "percent_of_total", null)] },
      { id: "00000000-0000-4000-8000-000000000033", model: "fixed_price", percentBasis: 1_000_000, leftoverCentTarget: "last_entry", lines: [line(1, "Deposit", "contract_signed", 500_000, "percent_of_total", null), line(2, "Milestone acceptance", "milestone_accepted", 500_000, "percent_of_total", null)] },
      { id: "00000000-0000-4000-8000-000000000034", model: "hourly", percentBasis: 1_000_000, leftoverCentTarget: "last_entry", lines: [line(1, "Hourly, invoiced per invoice at {rate}/hr", "manual", 1_000_000, "zero", 0)] },
    ],
    invoicePolicy: {
      signingDueOffsetDays: 0,
      milestoneDueOffsetDays: 0,
      preferMilestoneDueDate: true,
      initialStatus: "draft",
      unscopedRemainderRule: "sole_or_final_milestone",
      retainagePolicy: "add_on_accept",
      invoiceOnSign: true,
    },
    transitions: [
      { fromStatus: "draft", toStatus: "sent", staffOnly: true },
      { fromStatus: "sent", toStatus: "paid", staffOnly: false },
      { fromStatus: "draft", toStatus: "void", staffOnly: true },
      { fromStatus: "sent", toStatus: "void", staffOnly: true },
    ],
    mcpScopes: [...MCP_SCOPES],
    staffOnlyScopes: ["admin", "catalog:write"],
    grants: [
      { role: "staff", scope: "billing:read" },
      { role: "staff", scope: "billing:write" },
      { role: "staff", scope: "catalog:write" },
      { role: "staff", scope: "projects:read" },
      { role: "staff", scope: "projects:write" },
      { role: "staff", scope: "change_orders:write" },
      { role: "client", scope: "billing:read" },
      { role: "client", scope: "projects:read" },
      { role: "client", scope: "projects:write" },
    ],
  };
}

function mapRow(row: {
  id: string;
  updatedAt: Date;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  pricingModels: Array<{ id: string; code: CatalogTier["model"] }>;
  priceTiers: Array<{ code: string; pricingModelId: string; amountMinor: number; hours: number | null; minAmountMinor: number | null; currency: string }>;
  billingScheduleTemplates: Array<{ id: string; pricingModelId: string; percentBasis: number; leftoverCentTarget: "last_entry"; lines: Array<{ sortOrder: number; label: string; trigger: BillingTriggerName; percentBasis: number; amountMinor: number | null; amountRule: "percent_of_total" | "zero"; dueOffsetDays: number | null }> }>;
  invoicePolicy: ActiveCatalog["invoicePolicy"] | null;
  invoiceStatusTransitions: ActiveCatalog["transitions"];
  oauthScopes: Array<{ scope: string; mcp: boolean; staffOnly?: boolean }>;
  sessionScopeGrants: Array<{ role: string; scope: string }>;
}): ActiveCatalog {
  if (!row.invoicePolicy) throw new BillingScheduleError("The active catalog has no invoice policy.");
  const modelById = new Map(row.pricingModels.map((model) => [model.id, model.code]));
  return {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    tiers: row.priceTiers.map((tier) => ({
      code: tier.code,
      model: modelById.get(tier.pricingModelId) ?? "fixed_price",
      amountMinor: tier.amountMinor,
      hours: tier.hours,
      minAmountMinor: tier.minAmountMinor,
      currency: tier.currency,
    })),
    templates: row.billingScheduleTemplates.map((template) => ({
      id: template.id,
      model: modelById.get(template.pricingModelId) ?? "fixed_price",
      percentBasis: template.percentBasis,
      leftoverCentTarget: template.leftoverCentTarget,
      lines: [...template.lines].sort((left, right) => left.sortOrder - right.sortOrder),
    })),
    invoicePolicy: row.invoicePolicy,
    transitions: row.invoiceStatusTransitions,
    mcpScopes: row.oauthScopes.filter((scope) => scope.mcp).map((scope) => scope.scope),
    staffOnlyScopes: row.oauthScopes.filter((scope) => scope.mcp && scope.staffOnly).map((scope) => scope.scope),
    grants: row.sessionScopeGrants.map((grant) => ({ role: grant.role, scope: grant.scope })),
  };
}

const include = {
  pricingModels: true,
  priceTiers: true,
  billingScheduleTemplates: { include: { lines: true } },
  invoicePolicy: true,
  invoiceStatusTransitions: true,
  oauthScopes: true,
  sessionScopeGrants: true,
} as const;

/** Catalog version stamped on a contract, or the active catalog when the contract has none. */
export async function loadCatalogForVersion(prisma: object, catalogVersionId: string | null | undefined): Promise<ActiveCatalog> {
  const findFirst = (prisma as { catalogVersion?: { findFirst?: (args?: any) => Promise<any> } }).catalogVersion?.findFirst;
  if (!catalogVersionId || typeof findFirst !== "function") return loadActiveCatalog(prisma);
  const row = await findFirst({ where: { id: catalogVersionId }, include });
  if (!row) throw new BillingScheduleError("The contract catalog version was not found.");
  return mapRow(row as Parameters<typeof mapRow>[0]);
}

/**
 * Hour cap and per-hour rate for a stored proposal price.
 * Caps and rates come from the catalog price tiers. Capped packages bill amount_minor / hours.
 * An hourly tier with a null hours column has no cap.
 */
export function hourTermsFromCatalog(catalog: ActiveCatalog, pricing: unknown): { capHours: number | null; rateMinor: number; currency: string } {
  const price = pricing && typeof pricing === "object" && !Array.isArray(pricing) ? pricing as { model?: unknown; hours?: unknown } : {};
  if (price.model === "capped_hours") {
    const tier = catalog.tiers.find((item) => item.model === "capped_hours" && item.hours === price.hours);
    if (!tier?.hours) throw new BillingScheduleError("The contract hour cap is not in its catalog version.");
    return { capHours: tier.hours, rateMinor: Math.round(tier.amountMinor / tier.hours), currency: tier.currency };
  }
  if (price.model === "hourly") {
    const tier = catalog.tiers.find((item) => item.model === "hourly");
    if (!tier) throw new BillingScheduleError("The contract has no hourly rate in its catalog version.");
    return { capHours: tier.hours, rateMinor: tier.amountMinor, currency: tier.currency };
  }
  const tier = catalog.tiers.find((item) => item.model === price.model);
  if (!tier) throw new BillingScheduleError("The contract has no rate in its catalog version.");
  return {
    capHours: tier.hours,
    rateMinor: tier.hours ? Math.round(tier.amountMinor / tier.hours) : tier.amountMinor,
    currency: tier.currency,
  };
}

export async function loadActiveCatalog(prisma: object): Promise<ActiveCatalog> {
  const findFirst = (prisma as { catalogVersion?: { findFirst?: (args?: any) => Promise<any> } }).catalogVersion?.findFirst;
  if (typeof findFirst !== "function") return seedCatalogFixture();
  const now = new Date();
  const stamp = await findFirst({
    where: { status: "published", effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, updatedAt: true },
  }) as { id: string; updatedAt: Date } | null;
  if (!stamp) throw new BillingScheduleError("No active catalog version is published.");
  const updatedAt = stamp.updatedAt.toISOString();
  if (cached && cached.id === stamp.id && cached.updatedAt === updatedAt) return cached.catalog;
  const row = await findFirst({
    where: { id: stamp.id },
    include,
  });
  if (!row) throw new BillingScheduleError("No active catalog version is published.");
  const catalog = mapRow(row as Parameters<typeof mapRow>[0]);
  cached = { id: catalog.id, updatedAt: catalog.updatedAt, catalog };
  return catalog;
}

export function grantsForRole(catalog: ActiveCatalog, role: string): string[] {
  return catalog.grants.filter((grant) => grant.role === role).map((grant) => grant.scope);
}

function tierFor(catalog: ActiveCatalog, code: string): CatalogTier {
  const tier = catalog.tiers.find((item) => item.code === code);
  if (!tier) throw new BillingScheduleError(`The active catalog has no ${code} price tier.`);
  return tier;
}

export function pricingSchemaFor(catalog: ActiveCatalog) {
  const workflow = tierFor(catalog, "workflow_check");
  const four = tierFor(catalog, "capped_hours_4");
  const eight = tierFor(catalog, "capped_hours_8");
  const fixed = tierFor(catalog, "fixed_price");
  const hourly = tierFor(catalog, "hourly");
  const currencies = [...new Set(catalog.tiers.map((tier) => tier.currency))];
  const currency = z.enum(currencies as [string, ...string[]], { message: `Currency must be one of ${currencies.join(", ")}.` });
  const money = (amountMinor: number, code: string) => `${(amountMinor / 100).toLocaleString("en-US", { style: "currency", currency: code, maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 })}`;
  const fixedFloor = fixed.minAmountMinor ?? fixed.amountMinor;
  return z.discriminatedUnion("model", [
    z.object({ model: z.literal("workflow_check"), amountMinor: z.literal(workflow.amountMinor, { message: `Workflow Check is exactly ${money(workflow.amountMinor, workflow.currency)} (amountMinor ${workflow.amountMinor}).` }), currency: z.literal(workflow.currency, { message: `Currency must be ${workflow.currency}.` }) }).strict(),
    z.object({
      model: z.literal("capped_hours"),
      hours: z.union([z.literal(four.hours ?? -1), z.literal(eight.hours ?? -2)]),
      amountMinor: z.number().int(),
      currency,
    }).strict().refine(
      (value) => (value.hours === four.hours && value.amountMinor === four.amountMinor && value.currency === four.currency)
        || (value.hours === eight.hours && value.amountMinor === eight.amountMinor && value.currency === eight.currency),
      `Capped Hours must match a published tier: ${four.hours} hours at ${money(four.amountMinor, four.currency)} or ${eight.hours} hours at ${money(eight.amountMinor, eight.currency)}.`,
    ),
    z.object({
      model: z.literal("fixed_price"),
      amountMinor: z.number().int().min(fixedFloor, { message: `Fixed Price must be at least ${money(fixedFloor, fixed.currency)} (amountMinor ${fixedFloor}), the published catalog floor.` }),
      currency: z.literal(fixed.currency, { message: `Currency must be ${fixed.currency}.` }),
    }).strict(),
    z.object({ model: z.literal("hourly"), rateMinor: z.literal(hourly.amountMinor, { message: `The hourly rate is exactly ${money(hourly.amountMinor, hourly.currency)}/hr (rateMinor ${hourly.amountMinor}).` }), currency: z.literal(hourly.currency, { message: `Currency must be ${hourly.currency}.` }) }).strict(),
  ]);
}

export function parseCatalogPricing(catalog: ActiveCatalog, engagement: string, price: unknown): ProposalPricing {
  const parsed = pricingSchemaFor(catalog).safeParse(price);
  if (!parsed.success) {
    // Report every reason with its field, so callers see "pricing.amountMinor: Fixed Price must be at least $3,000" instead of a bare failure.
    const reasons = parsed.error.issues.map((issue) => `${issue.path.length ? `pricing.${issue.path.join(".")}: ` : ""}${issue.message}`);
    throw new BillingScheduleError(reasons.join(" ") || "The price is not in the active catalog.");
  }
  const value = parsed.data as ProposalPricing;
  if (!engagementMatchesCatalog(engagement, value, catalog)) {
    throw new BillingScheduleError(`A proposal has exactly one pricing model, and the engagement must match it: engagement ${engagement} does not match pricing model ${value.model}${value.model === "capped_hours" ? ` with ${value.hours} hours` : ""}.`);
  }
  return value;
}

function engagementMatchesCatalog(engagement: string, price: ProposalPricing, catalog: ActiveCatalog): boolean {
  if (engagement === "workflow_check") return price.model === "workflow_check";
  if (engagement === "fixed_price") return price.model === "fixed_price";
  if (engagement === "hourly") return price.model === "hourly";
  if (engagement === "capped_hours_4") return price.model === "capped_hours" && price.hours === tierFor(catalog, "capped_hours_4").hours;
  if (engagement === "capped_hours_8") return price.model === "capped_hours" && price.hours === tierFor(catalog, "capped_hours_8").hours;
  return false;
}

function allocate(totalMinor: number, bases: number[], full: number, leftover: "last_entry"): number[] {
  const amounts = bases.map((basis) => Math.floor((totalMinor * basis) / full));
  let remainder = totalMinor - amounts.reduce((sum, amount) => sum + amount, 0);
  const ranked = bases
    .map((basis, index) => ({ index, fraction: (totalMinor * basis) % full }))
    .sort((left, right) => right.fraction - left.fraction || (leftover === "last_entry" ? right.index - left.index : left.index - right.index));
  for (const row of ranked) {
    if (remainder === 0) break;
    const current = amounts[row.index] ?? 0;
    amounts[row.index] = current + 1;
    remainder -= 1;
  }
  if (remainder !== 0) throw new BillingScheduleError("Billing amounts could not be reconciled to the schedule total.");
  return amounts;
}

export function scheduleFromCatalog(catalog: ActiveCatalog, price: unknown): BillingScheduleDraft {
  const parsedResult = pricingSchemaFor(catalog).safeParse(price);
  if (!parsedResult.success) throw new BillingScheduleError(parsedResult.error.issues[0]?.message ?? "The price is not in the active catalog.");
  const parsed = parsedResult.data as ProposalPricing;
  const template = catalog.templates.find((item) => item.model === parsed.model);
  if (!template) throw new BillingScheduleError(`No billing schedule template is published for ${parsed.model}.`);
  const currency = "currency" in parsed ? parsed.currency : catalog.tiers[0]?.currency ?? "USD";
  const totalMinor = parsed.model === "hourly" ? 0 : parsed.amountMinor;
  const hourly = tierFor(catalog, "hourly");
  const rate = `$${hourly.amountMinor / 100}`;
  const hours = parsed.model === "capped_hours" ? String(parsed.hours) : "";
  const percentLines = template.lines.filter((line) => line.amountRule === "percent_of_total");
  const amounts = allocate(totalMinor, percentLines.map((line) => line.percentBasis), template.percentBasis, template.leftoverCentTarget);
  let percentIndex = 0;
  const entries = template.lines.map((line) => {
    const amountMinor = line.amountRule === "zero" ? (line.amountMinor ?? 0) : (amounts[percentIndex++] ?? 0);
    return {
      label: line.label.replaceAll("{hours}", hours).replaceAll("{rate}", rate),
      percent: basisToPercent(line.percentBasis),
      amountMinor,
      currency: currency as "USD",
      dueOn: null,
      trigger: line.trigger,
    };
  });
  const schedule: BillingScheduleDraft = { total: { amountMinor: totalMinor, currency: currency as "USD" }, entries };
  reconcileBillingSchedule(schedule);
  return schedule;
}

export function templateIdFor(catalog: ActiveCatalog, model: string): string {
  const template = catalog.templates.find((item) => item.model === model);
  if (!template) throw new BillingScheduleError(`No billing schedule template is published for ${model}.`);
  return template.id;
}

export function utcDay(now = new Date()): Date {
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function addUtcDays(day: Date, days: number): Date {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function signingInvoiceDue(catalog: ActiveCatalog, now = new Date()): Date {
  return addUtcDays(utcDay(now), catalog.invoicePolicy.signingDueOffsetDays);
}

export function milestoneInvoiceDue(catalog: ActiveCatalog, milestoneDue: Date | null, now = new Date()): Date {
  if (catalog.invoicePolicy.preferMilestoneDueDate && milestoneDue) return milestoneDue;
  return addUtcDays(utcDay(now), catalog.invoicePolicy.milestoneDueOffsetDays);
}

export function entriesForCatalogMilestone<T extends { milestoneId: string | null }>(catalog: ActiveCatalog, input: {
  milestoneId: string;
  milestones: MilestoneBillingTarget[];
  entries: T[];
}): T[] {
  if (catalog.invoicePolicy.unscopedRemainderRule !== "sole_or_final_milestone") {
    throw new BillingScheduleError(`Remainder rule ${catalog.invoicePolicy.unscopedRemainderRule} is not implemented.`);
  }
  const ownerId = milestoneThatOwnsUnscopedEntries(input.milestones);
  const ownsUnscoped = ownerId === input.milestoneId;
  return input.entries.filter((entry) => entry.milestoneId === input.milestoneId || (entry.milestoneId == null && ownsUnscoped));
}

export function publicCatalogView(catalog: ActiveCatalog) {
  const dollars = (minor: number) => minor / 100;
  const workflow = tierFor(catalog, "workflow_check");
  const four = tierFor(catalog, "capped_hours_4");
  const eight = tierFor(catalog, "capped_hours_8");
  const fixed = tierFor(catalog, "fixed_price");
  const hourly = tierFor(catalog, "hourly");
  const floor = fixed.minAmountMinor ?? fixed.amountMinor;
  const fixedFrom = floor === 300_000 ? "$3K" : `$${dollars(floor).toLocaleString("en-US")}`;
  return {
    id: catalog.id,
    effectiveFrom: catalog.effectiveFrom,
    effectiveTo: catalog.effectiveTo,
    currency: workflow.currency,
    workflowCheck: dollars(workflow.amountMinor),
    hourlyRate: dollars(hourly.amountMinor),
    capped4: { hours: four.hours, price: dollars(four.amountMinor) },
    capped8: { hours: eight.hours, price: dollars(eight.amountMinor) },
    fixedFrom,
    fixedFromDollars: dollars(floor),
    plans: [
      { id: "workflow_check", name: "Workflow Check", model: "workflow_check", price: { amountMinor: workflow.amountMinor, currency: workflow.currency }, hours: workflow.hours, priceKind: "exact" },
      { id: "capped_hours_4", name: "Capped Hours, 4", model: "capped_hours", price: { amountMinor: four.amountMinor, currency: four.currency }, hours: four.hours, priceKind: "exact" },
      { id: "capped_hours_8", name: "Capped Hours, 8", model: "capped_hours", price: { amountMinor: eight.amountMinor, currency: eight.currency }, hours: eight.hours, priceKind: "exact" },
      { id: "fixed_price", name: "Fixed Price", model: "fixed_price", price: { amountMinor: floor, currency: fixed.currency }, hours: null, priceKind: "minimum" },
      { id: "hourly", name: "Hourly", model: "hourly", price: { amountMinor: hourly.amountMinor, currency: hourly.currency }, hours: null, priceKind: "rate" },
    ],
  };
}

/** MCP scopes advertised to any client: everything with mcp=true except staff-only scopes. */
export function publicMcpScopes(catalog: Pick<ActiveCatalog, "mcpScopes" | "staffOnlyScopes">): string[] { const hidden = new Set(catalog.staffOnlyScopes ?? []); return catalog.mcpScopes.filter((scope) => !hidden.has(scope)); }
