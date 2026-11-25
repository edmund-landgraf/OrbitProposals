import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db.js";
import {
  BillingScheduleError,
  BillingScheduleSchema,
  ChangeOrderSchema,
  InvoiceSchema,
  MilestoneSchema,
  ProjectSchema,
  milestoneAcceptanceInvoiceAmount,
} from "../../packages/shapes/src/index.js";
import { entriesForCatalogMilestone, grantsForRole, loadActiveCatalog, milestoneInvoiceDue, utcDay } from "../catalog.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { applyOpenCredits, issueWorkflowCheckCredit, pricingModelOf, supportsCredits } from "../credits.js";
import { z } from "zod";
import type {} from "../sessionTypes.js";
import { ChargeError, chargeInvoice, stripeCharger, type Charger } from "../invoiceCharge.js";

export type BillingProjectsAuth = {
  userId: string;
  organizationId: string;
  role: "prospect" | "client" | "staff";
  scopes?: readonly string[];
};

export type BillingProjectsOptions = {
  prisma?: PrismaClient;
  authorize?: (request: Request, requiredScope: string, staffOnly?: boolean) => BillingProjectsAuth | null;
  /** undefined uses Stripe when STRIPE_SECRET_KEY is set. null refuses charges. */
  charge?: Charger | null;
};

type AuthenticatedRequest = Request & { billingProjectsAuth?: BillingProjectsAuth; billingProjectsDenial?: "anonymous" | "org_required" };

const ORG_REQUIRED_MESSAGE = "An organization is required. An admin can pass organizationId for an existing organization, or attach the user with npm run org:attach -- <email> <orgName>.";

const UUID = z.string().uuid();
const DateOnly = z.string().date();
const Currency = z.string().regex(/^[A-Z]{3}$/);
const MoneyInput = z.object({ amountMinor: z.number().int().nonnegative(), currency: Currency }).strict();
const Pagination = z.object({ cursor: UUID.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), organizationId: UUID.optional() }).strict();
const Status = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

const InvoiceCreateInput = z.object({
  contractId: UUID,
  amount: MoneyInput,
  dueDate: DateOnly,
  entryIds: z.array(UUID).max(100).optional(),
}).strict();

const ChangeOrderCreateInput = z.object({
  contractId: UUID,
  summary: z.string().trim().min(1).max(10_000),
  priceDelta: MoneyInput.nullable().optional(),
}).strict();

const ProjectCreateInput = z.object({
  contractId: UUID,
  title: z.string().trim().min(1).max(500),
  status: Status(["planned", "active", "blocked", "complete"] as const).default("planned"),
}).strict();

const ProjectUpdateInput = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  status: Status(["planned", "active", "blocked", "complete"] as const).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const MilestoneCreateInput = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).default(""),
  dueDate: DateOnly.nullable().optional(),
  status: Status(["planned", "in_progress", "submitted", "accepted", "blocked"] as const).default("planned"),
  retainage: MoneyInput.nullable().optional(),
}).strict();

const MilestoneUpdateInput = MilestoneCreateInput.partial().strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const iso = (value: Date): string => value.toISOString();
const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);
const requestId = (request: Request): string => {
  const candidate = typeof request.header("x-request-id") === "string" ? request.header("x-request-id") : undefined;
  return UUID.safeParse(candidate).success ? candidate! : randomUUID();
};

function success(response: Response, request: Request, entity: unknown, changed = false, links: Record<string, string> = {}, status = 200): void {
  response.status(status).json({ ok: true, ...(changed ? { changed: true } : {}), entity, warnings: [], links, requestId: requestId(request) });
}

function failure(response: Response, request: Request, status: number, code: string, message: string, details?: Array<{ path?: string; code: string; message: string }>): void {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, ...(details?.length ? { details } : {}), requestId: requestId(request) });
}

function validationFailure(response: Response, request: Request, error: z.ZodError): void {
  failure(response, request, 400, "VALIDATION_FAILED", "The request is not valid.", error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })));
}

function defaultAuthorize(request: Request, _requiredScope: string, staffOnly = false): BillingProjectsAuth | null {
  const candidate = (request as AuthenticatedRequest).billingProjectsAuth;
  if (!candidate || (staffOnly && candidate.role !== "staff") || (!staffOnly && candidate.role === "prospect")) return null;
  return candidate;
}


type CallerResolution =
  | { status: "ok"; auth: BillingProjectsAuth; stripBodyOrganizationId: boolean }
  | { status: "anonymous" | "org_required" };

function organizationIdFromRequest(request: Request): { id?: string; fromBody: boolean } {
  const query = request.query.organizationId;
  const fromQuery = typeof query === "string" ? query : undefined;
  const body = request.body as { organizationId?: unknown } | undefined;
  const fromBody = body && typeof body.organizationId === "string" ? body.organizationId : undefined;
  const value = fromQuery ?? fromBody;
  if (!value || !UUID.safeParse(value).success) return { fromBody: false };
  return { id: value, fromBody: fromQuery === undefined };
}

async function organizationForAdmin(database: PrismaClient, request: Request, admin: boolean): Promise<{ organizationId?: string; fromBody: boolean; missing: boolean }> {
  if (!admin) return { fromBody: false, missing: false };
  const requested = organizationIdFromRequest(request);
  if (!requested.id) return { fromBody: false, missing: false };
  const organization = await database.organization.findUnique({ where: { id: requested.id } });
  if (!organization) return { fromBody: requested.fromBody, missing: true };
  return { organizationId: organization.id, fromBody: requested.fromBody, missing: false };
}

async function resolveBillingCaller(database: PrismaClient, request: Request): Promise<CallerResolution> {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (!token) return { status: "anonymous" };
    const stored = await database.mcpToken.findFirst({
      where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { client: true, user: { include: { memberships: true } } },
    });
    if (!stored?.userId || !stored.user) return { status: "anonymous" };
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const admin = scopes.includes("admin");
    const membership = stored.user.memberships?.find((item) => item.status === "active");
    let organizationId = stored.client?.organizationId ?? membership?.organizationId ?? undefined;
    let stripBodyOrganizationId = false;
    if (!organizationId) {
      const requested = await organizationForAdmin(database, request, admin);
      if (requested.missing) return { status: "org_required" };
      organizationId = requested.organizationId;
      stripBodyOrganizationId = requested.fromBody && !!organizationId;
    }
    if (!organizationId) return { status: "org_required" };
    const role = membership?.role ?? (admin ? "staff" : "client");
    if (role !== "prospect" && role !== "client" && role !== "staff") return { status: "anonymous" };
    return { status: "ok", auth: { userId: stored.userId, organizationId, role, scopes }, stripBodyOrganizationId };
  }
  const userId = request.session?.userId;
  if (!userId) return { status: "anonymous" };
  const organizationId = request.session?.organizationId;
  const membership = organizationId
    ? await database.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
    : await database.membership.findFirst({ where: { userId, status: "active" }, orderBy: { organizationId: "asc" } });
  if (!membership || membership.status !== "active") return { status: "org_required" };
  if (membership.role !== "prospect" && membership.role !== "client" && membership.role !== "staff") return { status: "anonymous" };
  return {
    status: "ok",
    stripBodyOrganizationId: false,
    auth: {
      userId,
      organizationId: membership.organizationId,
      role: membership.role,
      scopes: grantsForRole(await loadActiveCatalog(database), membership.role),
    },
  };
}

function auth(options: BillingProjectsOptions, request: Request, response: Response, scope: string, staffOnly = false): BillingProjectsAuth | null {
  const identity = (options.authorize ?? defaultAuthorize)(request, scope, staffOnly);
  if (!identity) {
    const denial = (request as AuthenticatedRequest).billingProjectsDenial;
    if (denial === "org_required") {
      failure(response, request, 403, "ORG_REQUIRED", ORG_REQUIRED_MESSAGE);
      return null;
    }
    failure(response, request, staffOnly ? 403 : 401, staffOnly ? "FORBIDDEN" : "AUTH_REQUIRED", staffOnly ? "Staff authorization is required." : "Authentication is required.");
    return null;
  }
  if (identity.scopes && !scopeAllows(identity.scopes, scope)) {
    failure(response, request, 403, "SCOPE_REQUIRED", `The ${scope} scope is required.`);
    return null;
  }
  return identity;
}

function parseBody<T>(schema: z.ZodType<T>, request: Request, response: Response): T | null {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    validationFailure(response, request, result.error);
    return null;
  }
  return result.data;
}

function parseQuery(request: Request, response: Response): z.infer<typeof Pagination> | null {
  const result = Pagination.safeParse(request.query);
  if (!result.success) {
    validationFailure(response, request, result.error);
    return null;
  }
  return result.data;
}

function parseId(value: string | string[], request: Request, response: Response): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!UUID.safeParse(candidate).success) {
    failure(response, request, 400, "VALIDATION_FAILED", "The id must be a UUID.", [{ path: "id", code: "invalid_uuid", message: "Invalid UUID." }]);
    return null;
  }
  return candidate;
}

function invoiceEntity(invoice: { id: string; contractId: string; amountMinor: number; currency: string; status: string; dueDate: Date; paidAt: Date | null; createdAt: Date; grossMinor?: number | null; retainageMinor?: number | null; kind?: string | null }) {
  return InvoiceSchema.parse({
    id: invoice.id,
    contractId: invoice.contractId,
    amount: { amountMinor: invoice.amountMinor, currency: invoice.currency },
    status: invoice.status,
    dueDate: dateOnly(invoice.dueDate),
    paidAt: invoice.paidAt ? iso(invoice.paidAt) : null,
    createdAt: iso(invoice.createdAt),
    ...(invoice.grossMinor == null ? {} : { gross: { amountMinor: invoice.grossMinor, currency: invoice.currency }, retainage: { amountMinor: invoice.retainageMinor ?? 0, currency: invoice.currency }, kind: invoice.kind ?? "standard" }),
  });
}

function billingEntryEntity(entry: { id: string; label: string; percent: Prisma.Decimal; amountMinor: number; currency: string; dueOn: Date | null; trigger: string; milestoneId?: string | null; invoiceId: string | null }) {
  return {
    id: entry.id,
    label: entry.label,
    percent: entry.percent.toString(),
    amount: { amountMinor: entry.amountMinor, currency: entry.currency },
    dueOn: entry.dueOn ? dateOnly(entry.dueOn) : null,
    trigger: entry.trigger,
    milestoneId: entry.milestoneId ?? null,
    invoiceId: entry.invoiceId,
  };
}

function projectEntity(project: {
  id: string; contractId: string; organizationId: string; title: string; status: string; createdAt: Date; updatedAt: Date;
  milestones: Array<{ id: string; projectId: string; title: string; description: string; dueDate: Date | null; status: string; retainageMinor: number | null; retainageCurrency: string | null }>;
}) {
  return ProjectSchema.parse({
    id: project.id,
    contractId: project.contractId,
    organizationId: project.organizationId,
    title: project.title,
    status: project.status,
    milestones: project.milestones.map((milestone) => MilestoneSchema.parse({
      id: milestone.id,
      projectId: milestone.projectId,
      title: milestone.title,
      description: milestone.description,
      dueDate: milestone.dueDate ? dateOnly(milestone.dueDate) : null,
      status: milestone.status,
      retainage: milestone.retainageMinor == null || milestone.retainageCurrency == null ? null : { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency },
    })),
    createdAt: iso(project.createdAt),
    updatedAt: iso(project.updatedAt),
  });
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

type MilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: Date | null;
  status: string;
  retainageMinor: number | null;
  retainageCurrency: string | null;
  project: { id: string; contractId: string; organizationId: string };
};

function milestoneEntity(milestone: Omit<MilestoneRow, "project">) {
  return MilestoneSchema.parse({
    id: milestone.id,
    projectId: milestone.projectId,
    title: milestone.title,
    description: milestone.description,
    dueDate: milestone.dueDate ? dateOnly(milestone.dueDate) : null,
    status: milestone.status,
    retainage: milestone.retainageMinor == null || milestone.retainageCurrency == null ? null : { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency },
  });
}


export function createBillingProjectsRouter(options: BillingProjectsOptions = {}): Router {
  const router = Router();
  const database = options.prisma ?? defaultPrisma;

  router.use((request, _response, next) => {
    const current = request as AuthenticatedRequest;
    if (options.authorize || current.billingProjectsAuth) {
      next();
      return;
    }
    resolveBillingCaller(database, request).then((resolved) => {
      if (resolved.status === "ok") {
        current.billingProjectsAuth = resolved.auth;
        if (resolved.stripBodyOrganizationId && request.body && typeof request.body === "object") {
          delete (request.body as { organizationId?: string }).organizationId;
        }
      } else {
        current.billingProjectsDenial = resolved.status;
      }
      next();
    }, next);
  });

  router.get("/invoices", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const query = parseQuery(request, response);
    if (!query) return;
    if (typeof database.invoice.updateMany === "function") {
      await database.invoice.updateMany({ where: { status: "sent", dueDate: { lt: utcDay() }, contract: { organizationId: identity.organizationId } }, data: { status: "overdue" } });
    }
    const invoices = await database.invoice.findMany({
      where: { contract: { organizationId: identity.organizationId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasNext = invoices.length > query.limit;
    const items = invoices.slice(0, query.limit).map(invoiceEntity);
    success(response, request, { items, nextCursor: hasNext ? invoices[query.limit - 1].id : null, totalEstimate: await database.invoice.count({ where: { contract: { organizationId: identity.organizationId } } }) }, false, { self: "/api/v1/invoices" });
  }));

  router.post("/invoices", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write", true);
    if (!identity) return;
    const input = parseBody(InvoiceCreateInput, request, response);
    if (!input) return;
    const contract = await database.contract.findFirst({ where: { id: input.contractId, organizationId: identity.organizationId } });
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    if (input.entryIds?.length) {
      const count = await database.billingEntry.count({ where: { id: { in: input.entryIds }, contractId: input.contractId } });
      if (count !== input.entryIds.length) return failure(response, request, 400, "VALIDATION_FAILED", "All entryIds must belong to the contract.");
    }
    const invoice = await database.$transaction(async (transaction) => {
      const created = await transaction.invoice.create({ data: { contractId: input.contractId, amountMinor: input.amount.amountMinor, currency: input.amount.currency, dueDate: new Date(`${input.dueDate}T00:00:00.000Z`) } });
      if (input.entryIds?.length) await transaction.billingEntry.updateMany({ where: { id: { in: input.entryIds }, contractId: input.contractId }, data: { invoiceId: created.id } });
      return created;
    });
    success(response, request, invoiceEntity(invoice), true, { self: `/api/v1/invoices/${invoice.id}` }, 201);
  }));

  router.get("/invoices/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const invoice = await database.invoice.findFirst({ where: { id, contract: { organizationId: identity.organizationId } } });
    if (!invoice) return failure(response, request, 404, "NOT_FOUND", "The invoice was not found.");
    success(response, request, invoiceEntity(invoice), false, { self: `/api/v1/invoices/${id}` });
  }));

  async function transitionInvoice(request: Request, response: Response, nextStatus: "sent" | "paid" | "void"): Promise<void> {
    const identity = auth(options, request, response, "billing:write");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const invoice = await database.invoice.findFirst({ where: { id, contract: { organizationId: identity.organizationId } } });
    if (!invoice) return failure(response, request, 404, "NOT_FOUND", "The invoice was not found.");
    const catalog = await loadActiveCatalog(database);
    const fromStatus = invoice.status === "overdue" && (nextStatus === "paid" || nextStatus === "void") ? "sent" : invoice.status;
    const rule = catalog.transitions.find((item) => item.fromStatus === fromStatus && item.toStatus === nextStatus);
    if (!rule) return failure(response, request, 409, "CONFLICT", `Invoice cannot transition from ${invoice.status} to ${nextStatus}.`);
    if (rule.staffOnly && identity.role !== "staff") return failure(response, request, 403, "FORBIDDEN", "Staff authorization is required.");
    const updated = await database.invoice.update({ where: { id }, data: { status: nextStatus, ...(nextStatus === "paid" ? { paidAt: new Date() } : {}) } });
    if (nextStatus === "paid" && supportsCredits(database)) {
      const priced = await pricingModelOf(database, invoice.contractId);
      if (priced?.pricingModel === "workflow_check") {
        await issueWorkflowCheckCredit(database, {
          organizationId: priced.organizationId,
          contractId: invoice.contractId,
          invoiceId: invoice.id,
          catalogVersionId: priced.catalogVersionId ?? catalog.id,
          pricingModel: priced.pricingModel,
          sourceAmountMinor: invoice.amountMinor,
          currency: invoice.currency,
        });
      }
    }
    success(response, request, invoiceEntity(updated), true, { self: `/api/v1/invoices/${id}` });
  }
  router.post("/invoices/:id/send", asyncRoute((request, response) => transitionInvoice(request, response, "sent")));
  router.post("/invoices/:id/pay", asyncRoute((request, response) => transitionInvoice(request, response, "paid")));
  router.post("/invoices/:id/charge", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const body = z.object({ paymentMethodId: z.string().trim().min(1).max(80) }).strict().parse(request.body ?? {});
    const invoice = await database.invoice.findFirst({ where: { id, contract: { organizationId: identity.organizationId } } });
    if (!invoice) return failure(response, request, 404, "NOT_FOUND", "The invoice was not found.");
    const prior = await database.invoiceCharge.findFirst({ where: { invoiceId: id } });
    if (!prior) {
      const charger = options.charge !== undefined ? options.charge : (process.env.STRIPE_SECRET_KEY ? stripeCharger(process.env.STRIPE_SECRET_KEY) : null);
      try {
        const charged = await chargeInvoice({ invoiceId: id, amountMinor: invoice.amountMinor, currency: invoice.currency, status: invoice.status, paymentMethodId: body.paymentMethodId }, charger);
        await database.invoiceCharge.create({ data: { invoiceId: id, processor: charged.processor, processorId: charged.processorId, amountMinor: invoice.amountMinor, currency: invoice.currency } });
      } catch (error) {
        if (error instanceof ChargeError) return failure(response, request, error.status, error.code, error.message);
        throw error;
      }
    }
    await transitionInvoice(request, response, "paid");
  }));
  router.post("/invoices/:id/void", asyncRoute((request, response) => transitionInvoice(request, response, "void")));

  router.get("/contracts/:id/billing", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const contract = await database.contract.findFirst({ where: { id, organizationId: identity.organizationId }, include: { entries: true } });
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    const snapshot = contract.billing && typeof contract.billing === "object" && !Array.isArray(contract.billing) ? contract.billing as { total?: { amountMinor?: unknown; currency?: unknown } } : {};
    const currency = typeof snapshot.total?.currency === "string" ? snapshot.total.currency : contract.entries[0]?.currency ?? "USD";
    const totalMinor = typeof snapshot.total?.amountMinor === "number" ? snapshot.total.amountMinor : contract.entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
    const entity = BillingScheduleSchema.parse({ total: { amountMinor: totalMinor, currency }, entries: contract.entries.map(billingEntryEntity) });
    success(response, request, entity, false, { self: `/api/v1/contracts/${id}/billing` });
  }));

  router.post("/change-orders", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "change_orders:write");
    if (!identity) return;
    const input = parseBody(ChangeOrderCreateInput, request, response);
    if (!input) return;
    const contract = await database.contract.findFirst({ where: { id: input.contractId, organizationId: identity.organizationId } });
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    const changeOrder = await database.changeOrder.create({ data: { contractId: input.contractId, requestedBy: identity.userId, summary: input.summary, priceDeltaMinor: input.priceDelta?.amountMinor, priceCurrency: input.priceDelta?.currency } });
    success(response, request, ChangeOrderSchema.parse({ id: changeOrder.id, contractId: changeOrder.contractId, requestedBy: changeOrder.requestedBy, summary: changeOrder.summary, priceDelta: changeOrder.priceDeltaMinor == null || changeOrder.priceCurrency == null ? null : { amountMinor: changeOrder.priceDeltaMinor, currency: changeOrder.priceCurrency }, status: changeOrder.status }), true, { self: `/api/v1/change-orders/${changeOrder.id}` }, 201);
  }));

  const projectInclude = { milestones: { orderBy: [{ dueDate: "asc" as const }, { id: "asc" as const }] } };
  router.get("/projects", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:read");
    if (!identity) return;
    const query = parseQuery(request, response);
    if (!query) return;
    const projects = await database.project.findMany({ where: { organizationId: identity.organizationId }, include: projectInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
    const hasNext = projects.length > query.limit;
    success(response, request, { items: projects.slice(0, query.limit).map(projectEntity), nextCursor: hasNext ? projects[query.limit - 1].id : null, totalEstimate: await database.project.count({ where: { organizationId: identity.organizationId } }) }, false, { self: "/api/v1/projects" });
  }));

  router.post("/projects", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:write", true);
    if (!identity) return;
    const input = parseBody(ProjectCreateInput, request, response);
    if (!input) return;
    const contract = await database.contract.findFirst({ where: { id: input.contractId, organizationId: identity.organizationId } });
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    const project = await database.project.create({ data: { contractId: input.contractId, organizationId: identity.organizationId, title: input.title, status: input.status }, include: projectInclude });
    success(response, request, projectEntity(project), true, { self: `/api/v1/projects/${project.id}` }, 201);
  }));

  router.get("/projects/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const project = await database.project.findFirst({ where: { id, organizationId: identity.organizationId }, include: projectInclude });
    if (!project) return failure(response, request, 404, "NOT_FOUND", "The project was not found.");
    success(response, request, projectEntity(project), false, { self: `/api/v1/projects/${id}` });
  }));

  router.patch("/projects/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const input = parseBody(ProjectUpdateInput, request, response);
    if (!input) return;
    const existing = await database.project.findFirst({ where: { id, organizationId: identity.organizationId } });
    if (!existing) return failure(response, request, 404, "NOT_FOUND", "The project was not found.");
    const project = await database.project.update({ where: { id }, data: input, include: projectInclude });
    success(response, request, projectEntity(project), true, { self: `/api/v1/projects/${id}` });
  }));

  router.get("/projects/:id/milestones", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:read");
    if (!identity) return;
    const projectId = parseId(request.params.id, request, response);
    if (!projectId) return;
    const query = parseQuery(request, response);
    if (!query) return;
    const project = await database.project.findFirst({ where: { id: projectId, organizationId: identity.organizationId }, select: { id: true } });
    if (!project) return failure(response, request, 404, "NOT_FOUND", "The project was not found.");
    const milestones = await database.milestone.findMany({ where: { projectId }, orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
    const items = milestones.slice(0, query.limit).map((milestone) => MilestoneSchema.parse({ id: milestone.id, projectId: milestone.projectId, title: milestone.title, description: milestone.description, dueDate: milestone.dueDate ? dateOnly(milestone.dueDate) : null, status: milestone.status, retainage: milestone.retainageMinor == null || milestone.retainageCurrency == null ? null : { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency } }));
    success(response, request, { items, nextCursor: milestones.length > query.limit ? milestones[query.limit - 1].id : null, totalEstimate: await database.milestone.count({ where: { projectId } }) }, false, { self: `/api/v1/projects/${projectId}/milestones` });
  }));

  router.post("/projects/:id/milestones", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:write", true);
    if (!identity) return;
    const projectId = parseId(request.params.id, request, response);
    if (!projectId) return;
    const input = parseBody(MilestoneCreateInput, request, response);
    if (!input) return;
    const project = await database.project.findFirst({ where: { id: projectId, organizationId: identity.organizationId }, select: { id: true } });
    if (!project) return failure(response, request, 404, "NOT_FOUND", "The project was not found.");
    const milestone = await database.milestone.create({ data: { projectId, title: input.title, description: input.description, dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null, status: input.status, retainageMinor: input.retainage?.amountMinor, retainageCurrency: input.retainage?.currency } });
    success(response, request, MilestoneSchema.parse({ id: milestone.id, projectId: milestone.projectId, title: milestone.title, description: milestone.description, dueDate: milestone.dueDate ? dateOnly(milestone.dueDate) : null, status: milestone.status, retainage: milestone.retainageMinor == null || milestone.retainageCurrency == null ? null : { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency } }), true, { self: `/api/v1/milestones/${milestone.id}` }, 201);
  }));

  router.patch("/milestones/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const input = parseBody(MilestoneUpdateInput, request, response);
    if (!input) return;
    const existing = await database.milestone.findFirst({ where: { id, project: { organizationId: identity.organizationId } } });
    if (!existing) return failure(response, request, 404, "NOT_FOUND", "The milestone was not found.");
    if (existing.status === "accepted" && input.status && input.status !== "accepted") return failure(response, request, 409, "CONFLICT", "An accepted milestone cannot be reopened.");
    const milestone = await database.milestone.update({ where: { id }, data: { ...input, ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? new Date(`${input.dueDate}T00:00:00.000Z`) : null } : {}), ...(input.retainage !== undefined ? { retainageMinor: input.retainage?.amountMinor, retainageCurrency: input.retainage?.currency } : {}) } });
    success(response, request, MilestoneSchema.parse({ id: milestone.id, projectId: milestone.projectId, title: milestone.title, description: milestone.description, dueDate: milestone.dueDate ? dateOnly(milestone.dueDate) : null, status: milestone.status, retainage: milestone.retainageMinor == null || milestone.retainageCurrency == null ? null : { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency } }), true, { self: `/api/v1/milestones/${id}` });
  }));

  router.post("/milestones/:id/accept", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "projects:write");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    let outcome;
    try {
      outcome = await database.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(`SELECT "id" FROM "Milestone" WHERE "id" = $1::uuid FOR UPDATE`, id);
        const milestone = await transaction.milestone.findUnique({ where: { id }, include: { project: true } });
        if (!milestone) return { kind: "missing" as const };
        if (identity.organizationId && milestone.project.organizationId !== identity.organizationId) return { kind: "forbidden" as const };
        const milestones = await transaction.milestone.findMany({
          where: { project: { contractId: milestone.project.contractId } },
          select: { id: true, dueDate: true },
        });
        const targets = milestones.some((item) => item.id === milestone.id) ? milestones : [...milestones, { id: milestone.id, dueDate: milestone.dueDate }];
        if (milestone.status === "accepted") {
          const linked = await transaction.billingEntry.findMany({ where: { contractId: milestone.project.contractId, trigger: "milestone_accepted", invoiceId: { not: null } } });
          const owned = linked.filter((entry) => entry.milestoneId === milestone.id || (entry.milestoneId == null && targets.length <= 1));
          const invoiceIds = [...new Set(owned.map((entry) => entry.invoiceId).filter((invoiceId): invoiceId is string => typeof invoiceId === "string"))];
          const invoice = invoiceIds.length === 1 ? await transaction.invoice.findUnique({ where: { id: invoiceIds[0] ?? "" } }) : null;
          return { kind: "accepted" as const, changed: false, milestone, invoiceId: invoice?.id ?? null };
        }
        if (milestone.status !== "submitted") return { kind: "conflict" as const };
        await transaction.$queryRawUnsafe(`SELECT "id" FROM "Contract" WHERE "id" = $1::uuid FOR UPDATE`, milestone.project.contractId);
        const uninvoiced = await transaction.billingEntry.findMany({
          where: { contractId: milestone.project.contractId, trigger: "milestone_accepted", invoiceId: null },
          orderBy: { id: "asc" },
        });
        const catalog = await loadActiveCatalog(database);
        const entries = entriesForCatalogMilestone(catalog, { milestoneId: milestone.id, milestones: targets, entries: uninvoiced });
        const retainage = milestone.retainageMinor != null && milestone.retainageCurrency
          ? { amountMinor: milestone.retainageMinor, currency: milestone.retainageCurrency }
          : null;
        let priced: { amountMinor: number; currency: string } | null;
        try {
          priced = milestoneAcceptanceInvoiceAmount({ entries, retainage });
        } catch (error) {
          if (error instanceof BillingScheduleError) return { kind: "invalid" as const, message: error.message };
          throw error;
        }
        let invoiceId: string | null = null;
        if (priced) {
          const created = await transaction.invoice.create({
            data: {
              contractId: milestone.project.contractId,
              amountMinor: priced.amountMinor,
              currency: priced.currency,
              dueDate: milestoneInvoiceDue(catalog, milestone.dueDate),
              status: catalog.invoicePolicy.initialStatus,
            },
          });
          if (entries.length > 0) {
            const claimed = await transaction.billingEntry.updateMany({ where: { id: { in: entries.map((entry) => entry.id) }, invoiceId: null }, data: { invoiceId: created.id, milestoneId: milestone.id } });
            if (claimed.count !== entries.length) throw Object.assign(new Error("Billing entries were already invoiced."), { code: "BILLING_ENTRIES_CLAIMED" });
          }
          invoiceId = created.id;
          if (supportsCredits(transaction)) {
            const pricedContract = await pricingModelOf(transaction, milestone.project.contractId);
            if (pricedContract?.pricingModel) {
              await applyOpenCredits(transaction, {
                organizationId: milestone.project.organizationId,
                contractId: milestone.project.contractId,
                invoiceId: created.id,
                pricingModel: pricedContract.pricingModel,
                currency: priced.currency,
                amountMinor: priced.amountMinor,
              });
            }
          }
        }
        const updated = await transaction.milestone.update({ where: { id: milestone.id }, data: { status: "accepted" } });
        return { kind: "accepted" as const, changed: true, milestone: { ...updated, project: milestone.project }, invoiceId };
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "BILLING_ENTRIES_CLAIMED") {
        return failure(response, request, 409, "CONFLICT", "Those billing entries are already on an invoice.");
      }
      throw error;
    }
    if (outcome.kind === "missing") return failure(response, request, 404, "NOT_FOUND", "The milestone was not found.");
    if (outcome.kind === "forbidden") return failure(response, request, 403, "FORBIDDEN", "The milestone is outside the authorized organization.");
    if (outcome.kind === "conflict") return failure(response, request, 409, "CONFLICT", "Only submitted milestones can be accepted.");
    if (outcome.kind === "invalid") return failure(response, request, 400, "VALIDATION_FAILED", outcome.message);
    const links: Record<string, string> = { self: `/api/v1/milestones/${outcome.milestone.id}` };
    if (outcome.invoiceId) links.invoice = `/api/v1/invoices/${outcome.invoiceId}`;
    response.status(200).json({ ok: true, changed: outcome.changed, entity: milestoneEntity(outcome.milestone), warnings: [], links, requestId: requestId(request) });
  }));

  return router;
}

export const billingProjectsRouter = createBillingProjectsRouter();

