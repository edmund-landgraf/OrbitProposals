import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { grantsForRole, loadActiveCatalog } from "../catalog.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import {
  CatalogEditError,
  createCatalogDraft,
  getCatalogEditor,
  publishCatalogDraft,
  replaceInvoiceStatusTransitions,
  updateBillingScheduleLine,
  updateBillingScheduleTemplate,
  updateInvoicePolicy,
  updatePriceTier,
  updatePricingModel,
  validateCatalogDraft,
} from "../catalogEdit.js";

const SCOPE = "catalog:write";
const IdSchema = z.string().uuid();
const status = z.enum(["draft", "sent", "paid", "void"]);
const trigger = z.enum(["contract_signed", "milestone_accepted", "manual"]);

const PriceTierPatch = z.object({
  amountMinor: z.number().int().nonnegative().optional(),
  hours: z.number().int().positive().nullable().optional(),
  minAmountMinor: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict();

const LinePatch = z.object({
  sortOrder: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(300).optional(),
  trigger: trigger.optional(),
  percentBasis: z.number().int().nonnegative().optional(),
  amountMinor: z.number().int().nonnegative().nullable().optional(),
  amountRule: z.enum(["percent_of_total", "zero"]).optional(),
  dueOffsetDays: z.number().int().nullable().optional(),
}).strict();

const PolicyPatch = z.object({
  signingDueOffsetDays: z.number().int().nonnegative().optional(),
  milestoneDueOffsetDays: z.number().int().nonnegative().optional(),
  preferMilestoneDueDate: z.boolean().optional(),
  initialStatus: status.optional(),
  unscopedRemainderRule: z.literal("sole_or_final_milestone").optional(),
  retainagePolicy: z.literal("add_on_accept").optional(),
  invoiceOnSign: z.boolean().optional(),
}).strict();

const ModelPatch = z.object({ sortOrder: z.number().int().nonnegative() }).strict();
const TemplatePatch = z.object({
  percentBasis: z.number().int().positive().optional(),
  leftoverCentTarget: z.literal("last_entry").optional(),
}).strict();
const TransitionsBody = z.object({
  transitions: z.array(z.object({
    fromStatus: status,
    toStatus: status,
    staffOnly: z.boolean(),
  }).strict()).max(32),
}).strict();
const PublishBody = z.object({ effectiveFrom: z.string().datetime().optional() }).strict();

function requestId(request: Request): string {
  const supplied = request.header("x-request-id");
  return supplied && IdSchema.safeParse(supplied).success ? supplied : randomUUID();
}

function success(response: Response, request: Request, entity: unknown, changed = false, statusCode = 200): void {
  response.status(statusCode).json({ ok: true, ...(changed ? { changed: true } : {}), entity, warnings: [], links: {}, requestId: requestId(request) });
}

function failure(response: Response, request: Request, statusCode: number, code: string, message: string, details?: string[]): void {
  response.status(statusCode).json({ ok: false, code, message, retryable: statusCode >= 500, ...(details?.length ? { details } : {}), requestId: requestId(request) });
}

export async function authorize(prisma: PrismaClient, request: Request, response: Response): Promise<boolean> {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    const stored = token
      ? await prisma.mcpToken.findFirst({
        where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        include: { user: { include: { memberships: true } } },
      })
      : null;
    if (!stored?.userId || !stored.user) {
      failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required.");
      return false;
    }
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    if (!scopeAllows(scopes, SCOPE)) {
      failure(response, request, 403, "SCOPE_REQUIRED", `The ${SCOPE} scope is required.`);
      return false;
    }
    const membership = stored.user.memberships?.find((item) => item.status === "active");
    if (!scopes.includes("admin") && membership?.role !== "staff") {
      failure(response, request, 403, "FORBIDDEN", "Staff authorization is required.");
      return false;
    }
    return true;
  }
  const userId = request.session?.userId;
  if (!userId) {
    failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required.");
    return false;
  }
  const organizationId = request.session?.organizationId;
  const membership = organizationId
    ? await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
    : await prisma.membership.findFirst({ where: { userId, status: "active" }, orderBy: { organizationId: "asc" } });
  if (!membership || membership.status !== "active" || membership.role !== "staff") {
    failure(response, request, 403, "FORBIDDEN", "Staff authorization is required.");
    return false;
  }
  const scopes = grantsForRole(await loadActiveCatalog(prisma), membership.role);
  if (!scopeAllows(scopes, SCOPE)) {
    failure(response, request, 403, "SCOPE_REQUIRED", `The ${SCOPE} scope is required.`);
    return false;
  }
  return true;
}

function param(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function createCatalogEditRouter(options: { prisma: PrismaClient }): Router {
  const prisma = options.prisma;
  const router = Router();

  const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response, next: (error: unknown) => void) => {
    try {
      if (!(await authorize(prisma, request, response))) return;
      await handler(request, response);
    } catch (error) {
      if (error instanceof CatalogEditError) {
        failure(response, request, error.statusCode, error.code, error.message, error.details);
        return;
      }
      if (error instanceof z.ZodError) {
        failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues.map((issue) => issue.message));
        return;
      }
      next(error);
    }
  };

  router.get("/catalog/editor", run(async (request, response) => {
    const editor = await getCatalogEditor(prisma);
    success(response, request, { ...editor, draft: editor.draft ?? null });
  }));

  router.post("/catalog/drafts", run(async (request, response) => {
    success(response, request, await createCatalogDraft(prisma), true, 201);
  }));

  router.post("/catalog/drafts/:versionId/validate", run(async (request, response) => {
    success(response, request, await validateCatalogDraft(prisma, param(request, "versionId")));
  }));

  router.post("/catalog/drafts/:versionId/publish", run(async (request, response) => {
    const body = PublishBody.parse(request.body ?? {});
    const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();
    success(response, request, await publishCatalogDraft(prisma, param(request, "versionId"), effectiveFrom), true);
  }));

  router.patch("/catalog/drafts/:versionId/price-tiers/:code", run(async (request, response) => {
    const patch = PriceTierPatch.parse(request.body ?? {});
    success(response, request, await updatePriceTier(prisma, param(request, "versionId"), param(request, "code"), patch), true);
  }));

  router.patch("/catalog/drafts/:versionId/billing-schedule-lines/:lineId", run(async (request, response) => {
    const patch = LinePatch.parse(request.body ?? {});
    success(response, request, await updateBillingScheduleLine(prisma, param(request, "versionId"), param(request, "lineId"), patch), true);
  }));

  router.patch("/catalog/drafts/:versionId/invoice-policy", run(async (request, response) => {
    const patch = PolicyPatch.parse(request.body ?? {});
    success(response, request, await updateInvoicePolicy(prisma, param(request, "versionId"), patch), true);
  }));

  router.patch("/catalog/drafts/:versionId/pricing-models/:code", run(async (request, response) => {
    const patch = ModelPatch.parse(request.body ?? {});
    success(response, request, await updatePricingModel(prisma, param(request, "versionId"), param(request, "code"), patch.sortOrder), true);
  }));

  router.patch("/catalog/drafts/:versionId/billing-schedule-templates/:model", run(async (request, response) => {
    const patch = TemplatePatch.parse(request.body ?? {});
    success(response, request, await updateBillingScheduleTemplate(prisma, param(request, "versionId"), param(request, "model"), patch), true);
  }));

  router.put("/catalog/drafts/:versionId/invoice-status-transitions", run(async (request, response) => {
    const body = TransitionsBody.parse(request.body ?? {});
    success(response, request, await replaceInvoiceStatusTransitions(prisma, param(request, "versionId"), body.transitions), true);
  }));

  return router;
}
