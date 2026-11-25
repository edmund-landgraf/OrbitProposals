import type { InvoiceStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BillingScheduleError } from "../packages/shapes/src/index.js";
import {
  invalidateCatalogCache,
  scheduleFromCatalog,
  type ActiveCatalog,
  type CatalogLine,
  type CatalogTier,
} from "./catalog.js";

const DRAFT_EFFECTIVE_FROM = new Date("9999-12-31T00:00:00.000Z");
const CATALOG_WRITE = "catalog:write";

const editorInclude = {
  pricingModels: true,
  priceTiers: true,
  billingScheduleTemplates: { include: { lines: true } },
  invoicePolicy: true,
  invoiceStatusTransitions: true,
  oauthScopes: true,
  sessionScopeGrants: true,
  creditRules: { include: { targets: true } },
} satisfies Prisma.CatalogVersionInclude;

type EditorRow = Prisma.CatalogVersionGetPayload<{ include: typeof editorInclude }>;

export class CatalogEditError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: string[],
  ) {
    super(message);
  }
}

export type CatalogEditorDocument = {
  id: string;
  status: "draft" | "published";
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
  pricingModels: Array<{ id: string; code: string; sortOrder: number }>;
  priceTiers: Array<{ id: string; code: string; model: string; amountMinor: number; hours: number | null; minAmountMinor: number | null; currency: string }>;
  templates: Array<{
    id: string;
    model: string;
    percentBasis: number;
    leftoverCentTarget: string;
    lines: Array<{ id: string; sortOrder: number; label: string; trigger: string; percentBasis: number; amountMinor: number | null; amountRule: string; dueOffsetDays: number | null }>;
  }>;
  invoicePolicy: ActiveCatalog["invoicePolicy"] | null;
  transitions: Array<{ id: string; fromStatus: string; toStatus: string; staffOnly: boolean }>;
};

function activeWhere(now: Date): Prisma.CatalogVersionWhereInput {
  return {
    status: "published",
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  };
}

export function toEditorDocument(row: EditorRow): CatalogEditorDocument {
  const modelById = new Map(row.pricingModels.map((model) => [model.id, model.code]));
  return {
    id: row.id,
    status: row.status,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
    pricingModels: [...row.pricingModels].sort((left, right) => left.sortOrder - right.sortOrder).map((model) => ({ id: model.id, code: model.code, sortOrder: model.sortOrder })),
    priceTiers: row.priceTiers.map((tier) => ({
      id: tier.id,
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
      lines: [...template.lines].sort((left, right) => left.sortOrder - right.sortOrder).map((line) => ({
        id: line.id,
        sortOrder: line.sortOrder,
        label: line.label,
        trigger: line.trigger,
        percentBasis: line.percentBasis,
        amountMinor: line.amountMinor,
        amountRule: line.amountRule,
        dueOffsetDays: line.dueOffsetDays,
      })),
    })),
    invoicePolicy: row.invoicePolicy
      ? {
        signingDueOffsetDays: row.invoicePolicy.signingDueOffsetDays,
        milestoneDueOffsetDays: row.invoicePolicy.milestoneDueOffsetDays,
        preferMilestoneDueDate: row.invoicePolicy.preferMilestoneDueDate,
        initialStatus: row.invoicePolicy.initialStatus,
        unscopedRemainderRule: row.invoicePolicy.unscopedRemainderRule,
        retainagePolicy: row.invoicePolicy.retainagePolicy,
        invoiceOnSign: row.invoicePolicy.invoiceOnSign,
      }
      : null,
    transitions: row.invoiceStatusTransitions.map((transition) => ({
      id: transition.id,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      staffOnly: transition.staffOnly,
    })),
  };
}

function asActive(document: CatalogEditorDocument): ActiveCatalog {
  if (!document.invoicePolicy) throw new CatalogEditError(400, "VALIDATION_FAILED", "The catalog has no invoice policy.");
  return {
    id: document.id,
    updatedAt: document.updatedAt,
    effectiveFrom: document.effectiveFrom,
    effectiveTo: document.effectiveTo,
    tiers: document.priceTiers.map((tier) => ({
      code: tier.code,
      model: tier.model as CatalogTier["model"],
      amountMinor: tier.amountMinor,
      hours: tier.hours,
      minAmountMinor: tier.minAmountMinor,
      currency: tier.currency,
    })),
    templates: document.templates.map((template) => ({
      id: template.id,
      model: template.model as CatalogTier["model"],
      percentBasis: template.percentBasis,
      leftoverCentTarget: "last_entry",
      lines: template.lines.map((line): CatalogLine => ({
        sortOrder: line.sortOrder,
        label: line.label,
        trigger: line.trigger as CatalogLine["trigger"],
        percentBasis: line.percentBasis,
        amountMinor: line.amountMinor,
        amountRule: line.amountRule as CatalogLine["amountRule"],
        dueOffsetDays: line.dueOffsetDays,
      })),
    })),
    invoicePolicy: document.invoicePolicy,
    transitions: document.transitions.map((transition) => ({
      fromStatus: transition.fromStatus as ActiveCatalog["transitions"][number]["fromStatus"],
      toStatus: transition.toStatus as ActiveCatalog["transitions"][number]["toStatus"],
      staffOnly: transition.staffOnly,
    })),
    mcpScopes: [],
    grants: [],
  };
}

export function catalogProblems(document: CatalogEditorDocument): string[] {
  const problems: string[] = [];
  const required = ["workflow_check", "capped_hours_4", "capped_hours_8", "fixed_price", "hourly"];
  for (const code of required) {
    if (!document.priceTiers.some((tier) => tier.code === code)) problems.push(`Missing price tier ${code}.`);
  }
  for (const tier of document.priceTiers) {
    if (!Number.isInteger(tier.amountMinor) || tier.amountMinor < 0) problems.push(`Price tier ${tier.code} needs a non-negative integer amount.`);
    if (!/^[A-Z]{3}$/.test(tier.currency)) problems.push(`Price tier ${tier.code} needs a three-letter currency.`);
  }
  const models = new Set(document.pricingModels.map((model) => model.code));
  for (const model of ["workflow_check", "capped_hours", "fixed_price", "hourly"]) {
    if (!models.has(model)) problems.push(`Missing pricing model ${model}.`);
    if (!document.templates.some((template) => template.model === model)) problems.push(`Missing billing schedule template for ${model}.`);
  }
  for (const template of document.templates) {
    if (template.lines.length === 0) problems.push(`Template ${template.model} has no lines.`);
    const percentLines = template.lines.filter((line) => line.amountRule === "percent_of_total");
    const sum = percentLines.reduce((total, line) => total + line.percentBasis, 0);
    if (percentLines.length > 0 && sum !== template.percentBasis) {
      problems.push(`Template ${template.model} percent lines sum to ${sum}, not ${template.percentBasis}.`);
    }
    for (const line of template.lines) {
      if (!line.label.trim()) problems.push(`A ${template.model} line is missing a label.`);
    }
  }
  if (!document.invoicePolicy) problems.push("Missing invoice policy.");
  else if (document.invoicePolicy.signingDueOffsetDays < 0 || document.invoicePolicy.milestoneDueOffsetDays < 0) {
    problems.push("Invoice due offsets cannot be negative.");
  }
  if (problems.length > 0) return problems;
  try {
    const catalog = asActive(document);
    const workflow = document.priceTiers.find((tier) => tier.code === "workflow_check");
    const four = document.priceTiers.find((tier) => tier.code === "capped_hours_4");
    const eight = document.priceTiers.find((tier) => tier.code === "capped_hours_8");
    const fixed = document.priceTiers.find((tier) => tier.code === "fixed_price");
    const hourly = document.priceTiers.find((tier) => tier.code === "hourly");
    if (workflow) scheduleFromCatalog(catalog, { model: "workflow_check", amountMinor: workflow.amountMinor, currency: workflow.currency });
    if (four?.hours != null) scheduleFromCatalog(catalog, { model: "capped_hours", hours: four.hours, amountMinor: four.amountMinor, currency: four.currency });
    if (eight?.hours != null) scheduleFromCatalog(catalog, { model: "capped_hours", hours: eight.hours, amountMinor: eight.amountMinor, currency: eight.currency });
    if (fixed) scheduleFromCatalog(catalog, { model: "fixed_price", amountMinor: fixed.minAmountMinor ?? fixed.amountMinor, currency: fixed.currency });
    if (hourly) scheduleFromCatalog(catalog, { model: "hourly", rateMinor: hourly.amountMinor, currency: hourly.currency });
  } catch (error) {
    problems.push(error instanceof BillingScheduleError || error instanceof CatalogEditError ? error.message : "The catalog does not produce a billing schedule.");
  }
  return problems;
}

async function loadRow(prisma: PrismaClient, id: string): Promise<EditorRow> {
  const row = await prisma.catalogVersion.findFirst({ where: { id }, include: editorInclude });
  if (!row) throw new CatalogEditError(404, "NOT_FOUND", "The catalog version was not found.");
  return row;
}

async function requireDraft(prisma: PrismaClient, id: string): Promise<EditorRow> {
  const row = await loadRow(prisma, id);
  if (row.status !== "draft") throw new CatalogEditError(409, "CONFLICT", "Published catalog versions are immutable.");
  return row;
}

async function touch(prisma: PrismaClient, row: EditorRow): Promise<void> {
  await prisma.catalogVersion.update({ where: { id: row.id }, data: { effectiveFrom: row.effectiveFrom } });
}

export async function createCatalogDraft(prisma: PrismaClient, now = new Date()): Promise<CatalogEditorDocument> {
  const existing = await prisma.catalogVersion.findFirst({ where: { status: "draft" } });
  if (existing) throw new CatalogEditError(409, "CONFLICT", "A catalog draft already exists. Publish or delete it before creating another.");
  const source = await prisma.catalogVersion.findFirst({
    where: activeWhere(now),
    orderBy: { effectiveFrom: "desc" },
    include: editorInclude,
  });
  if (!source) throw new CatalogEditError(409, "CONFLICT", "No active catalog version is published.");
  const created = await prisma.$transaction(async (tx) => {
    const draft = await tx.catalogVersion.create({
      data: { id: randomUUID(), status: "draft", effectiveFrom: DRAFT_EFFECTIVE_FROM, effectiveTo: null },
    });
    const modelIds = new Map<string, string>();
    for (const model of source.pricingModels) {
      const id = randomUUID();
      modelIds.set(model.id, id);
      await tx.catalogPricingModel.create({
        data: { id, catalogVersionId: draft.id, code: model.code, sortOrder: model.sortOrder },
      });
    }
    for (const tier of source.priceTiers) {
      const pricingModelId = modelIds.get(tier.pricingModelId);
      if (!pricingModelId) throw new CatalogEditError(500, "INTERNAL_ERROR", "A price tier has no pricing model.");
      await tx.priceTier.create({
        data: {
          id: randomUUID(),
          catalogVersionId: draft.id,
          pricingModelId,
          code: tier.code,
          amountMinor: tier.amountMinor,
          hours: tier.hours,
          minAmountMinor: tier.minAmountMinor,
          currency: tier.currency,
        },
      });
    }
    for (const template of source.billingScheduleTemplates) {
      const pricingModelId = modelIds.get(template.pricingModelId);
      if (!pricingModelId) throw new CatalogEditError(500, "INTERNAL_ERROR", "A billing template has no pricing model.");
      const templateId = randomUUID();
      await tx.billingScheduleTemplate.create({
        data: {
          id: templateId,
          catalogVersionId: draft.id,
          pricingModelId,
          percentBasis: template.percentBasis,
          leftoverCentTarget: template.leftoverCentTarget,
        },
      });
      for (const line of template.lines) {
        await tx.billingScheduleTemplateLine.create({
          data: {
            id: randomUUID(),
            templateId,
            sortOrder: line.sortOrder,
            label: line.label,
            trigger: line.trigger,
            percentBasis: line.percentBasis,
            amountMinor: line.amountMinor,
            amountRule: line.amountRule,
            dueOffsetDays: line.dueOffsetDays,
          },
        });
      }
    }
    if (source.invoicePolicy) {
      const policy = source.invoicePolicy;
      await tx.invoicePolicy.create({
        data: {
          id: randomUUID(),
          catalogVersionId: draft.id,
          signingDueOffsetDays: policy.signingDueOffsetDays,
          milestoneDueOffsetDays: policy.milestoneDueOffsetDays,
          preferMilestoneDueDate: policy.preferMilestoneDueDate,
          initialStatus: policy.initialStatus,
          unscopedRemainderRule: policy.unscopedRemainderRule,
          retainagePolicy: policy.retainagePolicy,
          invoiceOnSign: policy.invoiceOnSign,
        },
      });
    }
    for (const transition of source.invoiceStatusTransitions) {
      await tx.invoiceStatusTransition.create({
        data: {
          id: randomUUID(),
          catalogVersionId: draft.id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          staffOnly: transition.staffOnly,
        },
      });
    }
    const scopes = source.oauthScopes.some((scope) => scope.scope === CATALOG_WRITE)
      ? source.oauthScopes
      : [...source.oauthScopes, { scope: CATALOG_WRITE, mcp: true, staffOnly: true }];
    for (const scope of scopes) {
      await tx.oauthScope.create({ data: { id: randomUUID(), catalogVersionId: draft.id, scope: scope.scope, mcp: scope.mcp, staffOnly: (scope as { staffOnly?: boolean }).staffOnly ?? scope.scope === CATALOG_WRITE } });
    }
    const grants = source.sessionScopeGrants.some((grant) => grant.role === "staff" && grant.scope === CATALOG_WRITE)
      ? source.sessionScopeGrants
      : [...source.sessionScopeGrants, { role: "staff" as const, scope: CATALOG_WRITE }];
    for (const grant of grants) {
      await tx.sessionScopeGrant.create({ data: { id: randomUUID(), catalogVersionId: draft.id, role: grant.role, scope: grant.scope } });
    }
    const creditWriter = tx as unknown as { creditRule?: { create: (args: { data: Prisma.CreditRuleUncheckedCreateInput }) => Promise<unknown> }; creditRuleTarget?: { create: (args: { data: Prisma.CreditRuleTargetUncheckedCreateInput }) => Promise<unknown> } };
    if (creditWriter.creditRule && creditWriter.creditRuleTarget) {
    for (const rule of source.creditRules ?? []) {
      const creditRuleId = randomUUID();
      await creditWriter.creditRule.create({
        data: {
          id: creditRuleId,
          catalogVersionId: draft.id,
          code: rule.code,
          sourcePricingModel: rule.sourcePricingModel,
          sourceTierCode: rule.sourceTierCode,
          windowDays: rule.windowDays,
          creditAmountMinor: rule.creditAmountMinor,
          creditPercentBasis: rule.creditPercentBasis,
          currency: rule.currency,
        },
      });
      for (const target of rule.targets) {
        await creditWriter.creditRuleTarget.create({
          data: { id: randomUUID(), creditRuleId, pricingModel: target.pricingModel, tierCode: target.tierCode },
        });
      }
    }
    }
    const row = await tx.catalogVersion.findFirst({ where: { id: draft.id }, include: editorInclude });
    if (!row) throw new CatalogEditError(500, "INTERNAL_ERROR", "The catalog draft was not stored.");
    return row;
  });
  return toEditorDocument(created);
}

export async function getCatalogEditor(prisma: PrismaClient, now = new Date()): Promise<{ active: CatalogEditorDocument | null; draft: CatalogEditorDocument | null }> {
  const active = await prisma.catalogVersion.findFirst({
    where: activeWhere(now),
    orderBy: { effectiveFrom: "desc" },
    include: editorInclude,
  });
  let draft: EditorRow | null = null;
  try {
    draft = await prisma.catalogVersion.findFirst({ where: { status: "draft" }, include: editorInclude });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "P2025") throw error;
  }
  return {
    active: active ? toEditorDocument(active) : null,
    draft: draft ? toEditorDocument(draft) : null,
  };
}

export type PriceTierPatch = { amountMinor?: number; hours?: number | null; minAmountMinor?: number | null; currency?: string };

export async function updatePriceTier(prisma: PrismaClient, versionId: string, code: string, patch: PriceTierPatch): Promise<CatalogEditorDocument> {
  const draft = await requireDraft(prisma, versionId);
  const tier = draft.priceTiers.find((item) => item.code === code);
  if (!tier) throw new CatalogEditError(404, "NOT_FOUND", `The draft has no price tier ${code}.`);
  await prisma.priceTier.update({
    where: { id: tier.id },
    data: {
      ...(patch.amountMinor === undefined ? {} : { amountMinor: patch.amountMinor }),
      ...(patch.hours === undefined ? {} : { hours: patch.hours }),
      ...(patch.minAmountMinor === undefined ? {} : { minAmountMinor: patch.minAmountMinor }),
      ...(patch.currency === undefined ? {} : { currency: patch.currency }),
    },
  });
  await touch(prisma, draft);
  return toEditorDocument(await loadRow(prisma, versionId));
}

export type BillingLinePatch = {
  sortOrder?: number;
  label?: string;
  trigger?: "contract_signed" | "milestone_accepted" | "manual";
  percentBasis?: number;
  amountMinor?: number | null;
  amountRule?: "percent_of_total" | "zero";
  dueOffsetDays?: number | null;
};

export async function updateBillingScheduleLine(prisma: PrismaClient, versionId: string, lineId: string, patch: BillingLinePatch): Promise<CatalogEditorDocument> {
  const draft = await requireDraft(prisma, versionId);
  const line = draft.billingScheduleTemplates.flatMap((template) => template.lines).find((item) => item.id === lineId);
  if (!line) throw new CatalogEditError(404, "NOT_FOUND", "The draft has no billing schedule line with that id.");
  await prisma.billingScheduleTemplateLine.update({
    where: { id: line.id },
    data: {
      ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
      ...(patch.label === undefined ? {} : { label: patch.label }),
      ...(patch.trigger === undefined ? {} : { trigger: patch.trigger }),
      ...(patch.percentBasis === undefined ? {} : { percentBasis: patch.percentBasis }),
      ...(patch.amountMinor === undefined ? {} : { amountMinor: patch.amountMinor }),
      ...(patch.amountRule === undefined ? {} : { amountRule: patch.amountRule }),
      ...(patch.dueOffsetDays === undefined ? {} : { dueOffsetDays: patch.dueOffsetDays }),
    },
  });
  await touch(prisma, draft);
  return toEditorDocument(await loadRow(prisma, versionId));
}

export type InvoicePolicyPatch = Partial<ActiveCatalog["invoicePolicy"]>;

export async function updateInvoicePolicy(prisma: PrismaClient, versionId: string, patch: InvoicePolicyPatch): Promise<CatalogEditorDocument> {
  const draft = await requireDraft(prisma, versionId);
  if (!draft.invoicePolicy) throw new CatalogEditError(404, "NOT_FOUND", "The draft has no invoice policy.");
  await prisma.invoicePolicy.update({
    where: { id: draft.invoicePolicy.id },
    data: {
      ...(patch.signingDueOffsetDays === undefined ? {} : { signingDueOffsetDays: patch.signingDueOffsetDays }),
      ...(patch.milestoneDueOffsetDays === undefined ? {} : { milestoneDueOffsetDays: patch.milestoneDueOffsetDays }),
      ...(patch.preferMilestoneDueDate === undefined ? {} : { preferMilestoneDueDate: patch.preferMilestoneDueDate }),
      ...(patch.initialStatus === undefined ? {} : { initialStatus: patch.initialStatus }),
      ...(patch.unscopedRemainderRule === undefined ? {} : { unscopedRemainderRule: patch.unscopedRemainderRule }),
      ...(patch.retainagePolicy === undefined ? {} : { retainagePolicy: patch.retainagePolicy }),
      ...(patch.invoiceOnSign === undefined ? {} : { invoiceOnSign: patch.invoiceOnSign }),
    },
  });
  await touch(prisma, draft);
  return toEditorDocument(await loadRow(prisma, versionId));
}

export async function updatePricingModel(prisma: PrismaClient, versionId: string, code: string, sortOrder: number): Promise<CatalogEditorDocument> {
  const draft = await requireDraft(prisma, versionId);
  const model = draft.pricingModels.find((item) => item.code === code);
  if (!model) throw new CatalogEditError(404, "NOT_FOUND", `The draft has no pricing model ${code}.`);
  await prisma.catalogPricingModel.update({ where: { id: model.id }, data: { sortOrder } });
  await touch(prisma, draft);
  return toEditorDocument(await loadRow(prisma, versionId));
}

export async function updateBillingScheduleTemplate(
  prisma: PrismaClient,
  versionId: string,
  model: string,
  patch: { percentBasis?: number; leftoverCentTarget?: "last_entry" },
): Promise<CatalogEditorDocument> {
  const draft = await requireDraft(prisma, versionId);
  const template = draft.billingScheduleTemplates.find((item) => {
    const code = draft.pricingModels.find((pricing) => pricing.id === item.pricingModelId)?.code;
    return code === model;
  });
  if (!template) throw new CatalogEditError(404, "NOT_FOUND", `The draft has no billing template for ${model}.`);
  await prisma.billingScheduleTemplate.update({
    where: { id: template.id },
    data: {
      ...(patch.percentBasis === undefined ? {} : { percentBasis: patch.percentBasis }),
      ...(patch.leftoverCentTarget === undefined ? {} : { leftoverCentTarget: patch.leftoverCentTarget }),
    },
  });
  await touch(prisma, draft);
  return toEditorDocument(await loadRow(prisma, versionId));
}

export async function replaceInvoiceStatusTransitions(
  prisma: PrismaClient,
  versionId: string,
  transitions: Array<{ fromStatus: InvoiceStatus; toStatus: InvoiceStatus; staffOnly: boolean }>,
): Promise<CatalogEditorDocument> {
  await requireDraft(prisma, versionId);
  const seen = new Set<string>();
  for (const transition of transitions) {
    const key = `${transition.fromStatus}->${transition.toStatus}`;
    if (seen.has(key)) throw new CatalogEditError(400, "VALIDATION_FAILED", `Duplicate transition ${key}.`);
    seen.add(key);
  }
  await prisma.$transaction(async (tx) => {
    await tx.invoiceStatusTransition.deleteMany({ where: { catalogVersionId: versionId } });
    for (const transition of transitions) {
      await tx.invoiceStatusTransition.create({
        data: { id: randomUUID(), catalogVersionId: versionId, fromStatus: transition.fromStatus, toStatus: transition.toStatus, staffOnly: transition.staffOnly },
      });
    }
    const row = await tx.catalogVersion.findFirst({ where: { id: versionId }, include: editorInclude });
    if (row) await tx.catalogVersion.update({ where: { id: versionId }, data: { effectiveFrom: row.effectiveFrom } });
  });
  return toEditorDocument(await loadRow(prisma, versionId));
}

export async function validateCatalogDraft(prisma: PrismaClient, versionId: string): Promise<{ valid: true; problems: [] }> {
  const row = await requireDraft(prisma, versionId);
  const problems = catalogProblems(toEditorDocument(row));
  if (problems.length > 0) throw new CatalogEditError(400, "VALIDATION_FAILED", "The catalog draft is not valid.", problems);
  return { valid: true, problems: [] };
}

export async function publishCatalogDraft(prisma: PrismaClient, versionId: string, effectiveFrom = new Date()): Promise<CatalogEditorDocument> {
  await validateCatalogDraft(prisma, versionId);
  const published = await prisma.$transaction(async (tx) => {
    const draft = await tx.catalogVersion.findFirst({ where: { id: versionId }, include: editorInclude });
    if (!draft || draft.status !== "draft") throw new CatalogEditError(409, "CONFLICT", "Published catalog versions are immutable.");
    const previous = await tx.catalogVersion.findMany({
      where: {
        id: { not: versionId },
        status: "published",
        effectiveFrom: { lte: effectiveFrom },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
      },
    });
    for (const version of previous) {
      await tx.catalogVersion.update({ where: { id: version.id }, data: { effectiveTo: effectiveFrom } });
    }
    await tx.catalogVersion.update({ where: { id: versionId }, data: { status: "published", effectiveFrom, effectiveTo: null } });
    const row = await tx.catalogVersion.findFirst({ where: { id: versionId }, include: editorInclude });
    if (!row) throw new CatalogEditError(500, "INTERNAL_ERROR", "The published catalog was not stored.");
    return row;
  });
  invalidateCatalogCache();
  return toEditorDocument(published);
}
