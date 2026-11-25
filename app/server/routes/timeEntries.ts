import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { Prisma as PrismaRuntime, type PrismaClient } from "../prismaClient.js";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { BillingScheduleError } from "../../packages/shapes/src/index.js";
import { hourTermsFromCatalog, loadCatalogForVersion, signingInvoiceDue } from "../catalog.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { applyOpenCredits, supportsCredits } from "../credits.js";
import { prisma as defaultPrisma } from "../db.js";
import type {} from "../sessionTypes.js";

export type TimeAuth = {
  userId: string;
  organizationId: string;
  role: "prospect" | "client" | "staff";
  scopes?: readonly string[];
};

export type TimeEntryOptions = {
  prisma?: PrismaClient;
  authorize?: (request: Request, requiredScope: string, staffOnly?: boolean) => TimeAuth | null;
};

type AuthenticatedRequest = Request & { timeAuth?: TimeAuth };

const UUID = z.string().uuid();
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hours = z.number().positive().max(24).refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, "Hours use at most two decimal places.");

const CreateInput = z.object({
  date: DateOnly,
  hours: Hours,
  description: z.string().trim().min(1).max(2000),
  billable: z.boolean().default(true),
}).strict();

const UpdateInput = CreateInput.partial().strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

const InvoiceHoursInput = z.object({ from: DateOnly, to: DateOnly }).strict().refine((value) => value.from <= value.to, "from must be on or before to.");

const requestId = (request: Request): string => {
  const candidate = request.header("x-request-id");
  return typeof candidate === "string" && UUID.safeParse(candidate).success ? candidate : randomUUID();
};

function success(response: Response, request: Request, entity: unknown, changed = false, status = 200): void {
  response.status(status).json({ ok: true, ...(changed ? { changed: true } : {}), entity, warnings: [], requestId: requestId(request) });
}

function failure(response: Response, request: Request, status: number, code: string, message: string): void {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, requestId: requestId(request) });
}

function defaultAuthorize(request: Request, _requiredScope: string, staffOnly = false): TimeAuth | null {
  const candidate = (request as AuthenticatedRequest).timeAuth;
  if (!candidate || (staffOnly && candidate.role !== "staff") || (!staffOnly && candidate.role === "prospect")) return null;
  return candidate;
}

async function resolveCaller(database: PrismaClient, request: Request): Promise<TimeAuth | null> {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (!token) return null;
    const stored = await database.mcpToken.findFirst({
      where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { client: true, user: { include: { memberships: true } } },
    });
    if (!stored?.userId || !stored.user) return null;
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const membership = stored.user.memberships.find((item) => item.status === "active");
    const organizationId = stored.client.organizationId ?? membership?.organizationId;
    if (!organizationId) return null;
    const role = membership?.role ?? "client";
    if (role !== "prospect" && role !== "client" && role !== "staff") return null;
    return { userId: stored.userId, organizationId, role, scopes };
  }
  const userId = request.session?.userId;
  if (!userId) return null;
  const organizationId = request.session?.organizationId;
  const membership = organizationId
    ? await database.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
    : await database.membership.findFirst({ where: { userId, status: "active" }, orderBy: { organizationId: "asc" } });
  if (!membership || membership.status !== "active") return null;
  if (membership.role !== "prospect" && membership.role !== "client" && membership.role !== "staff") return null;
  const { grantsForRole, loadActiveCatalog } = await import("../catalog.js");
  return { userId, organizationId: membership.organizationId, role: membership.role, scopes: grantsForRole(await loadActiveCatalog(database), membership.role) };
}

function auth(options: TimeEntryOptions, request: Request, response: Response, scope: string, staffOnly = false): TimeAuth | null {
  const identity = (options.authorize ?? defaultAuthorize)(request, scope, staffOnly);
  if (!identity) {
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
    failure(response, request, 400, "VALIDATION_FAILED", result.error.issues[0]?.message ?? "The request is not valid.");
    return null;
  }
  return result.data;
}

function parseId(value: string | string[] | undefined, request: Request, response: Response): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!UUID.safeParse(candidate).success) {
    failure(response, request, 400, "VALIDATION_FAILED", "The id must be a UUID.");
    return null;
  }
  return candidate ?? null;
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function hundredths(hours: number): number {
  return Math.round(hours * 100);
}

function fromHundredths(value: number): number {
  return value / 100;
}

function hoursOf(value: Prisma.Decimal | number | string): number {
  return fromHundredths(hundredths(Number(value.toString())));
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

type EntryRow = {
  id: string;
  contractId: string;
  userId: string;
  date: Date;
  hours: Prisma.Decimal | number | string;
  description: string;
  billable: boolean;
  invoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function entryEntity(entry: EntryRow) {
  return {
    id: entry.id,
    contractId: entry.contractId,
    userId: entry.userId,
    date: dateOnly(entry.date),
    hours: hoursOf(entry.hours),
    description: entry.description,
    billable: entry.billable,
    invoiceId: entry.invoiceId,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

type ContractRow = {
  id: string;
  organizationId: string;
  catalogVersionId: string | null;
  proposal: { pricing: unknown; catalogVersionId: string | null };
};

async function loadContract(database: PrismaClient, id: string, organizationId: string): Promise<ContractRow | null> {
  return database.contract.findFirst({
    where: { id, organizationId },
    include: { proposal: { select: { pricing: true, catalogVersionId: true } } },
  }) as Promise<ContractRow | null>;
}

async function termsFor(database: PrismaClient, contract: ContractRow) {
  const catalog = await loadCatalogForVersion(database, contract.catalogVersionId ?? contract.proposal.catalogVersionId);
  return { catalog, terms: hourTermsFromCatalog(catalog, contract.proposal.pricing) };
}

async function loggedHundredths(database: Prisma.TransactionClient | PrismaClient, contractId: string, exceptId?: string): Promise<number> {
  const rows = await database.timeEntry.findMany({ where: { contractId, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { hours: true } });
  return rows.reduce((sum, row) => sum + hundredths(hoursOf(row.hours)), 0);
}

/** Serialize all hour mutations for a contract on the contract row itself. */
async function lockContract(transaction: Prisma.TransactionClient, contractId: string): Promise<void> {
  await transaction.$queryRaw(PrismaRuntime.sql`SELECT "id" FROM "Contract" WHERE "id" = ${contractId} FOR UPDATE`);
}

function capMessage(capHours: number, logged: number, requested: number): string {
  return `This entry would exceed the hour cap of ${capHours} hours. ${fromHundredths(logged)} hours are already logged and this entry is ${fromHundredths(requested)} hours.`;
}

export function createTimeEntriesRouter(options: TimeEntryOptions = {}): Router {
  const router = Router();
  const database = options.prisma ?? defaultPrisma;

  router.use((request, _response, next) => {
    const current = request as AuthenticatedRequest;
    if (options.authorize || current.timeAuth) {
      next();
      return;
    }
    resolveCaller(database, request).then((resolved) => {
      if (resolved) current.timeAuth = resolved;
      next();
    }, next);
  });

  router.get("/contracts/:id/time-entries", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const contract = await loadContract(database, id, identity.organizationId);
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    const entries = await database.timeEntry.findMany({ where: { contractId: id }, orderBy: [{ date: "asc" }, { id: "asc" }] });
    success(response, request, { items: entries.map((entry) => entryEntity(entry as EntryRow)) });
  }));

  router.post("/contracts/:id/time-entries", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const input = parseBody(CreateInput, request, response);
    if (!input) return;
    const contract = await loadContract(database, id, identity.organizationId);
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    let terms: { capHours: number | null; rateMinor: number; currency: string };
    try {
      terms = (await termsFor(database, contract)).terms;
    } catch (error) {
      if (error instanceof BillingScheduleError) return failure(response, request, 409, "CONFLICT", error.message);
      throw error;
    }
    const requested = hundredths(input.hours);
    const result = await database.$transaction(async (transaction) => {
      await lockContract(transaction, id);
      const logged = await loggedHundredths(transaction, id);
      if (terms.capHours != null && logged + requested > hundredths(terms.capHours)) return { created: null, logged };
      const created = await transaction.timeEntry.create({
        data: {
          contractId: id,
          userId: identity.userId,
          date: new Date(`${input.date}T00:00:00.000Z`),
          hours: new PrismaRuntime.Decimal(input.hours.toFixed(2)),
          description: input.description,
          billable: input.billable,
        },
      });
      return { created, logged };
    });
    if (!result.created) return failure(response, request, 409, "HOUR_CAP_EXCEEDED", capMessage(terms.capHours as number, result.logged, requested));
    const remaining = terms.capHours == null ? null : fromHundredths(hundredths(terms.capHours) - result.logged - requested);
    success(response, request, { ...entryEntity(result.created as EntryRow), remainingHours: remaining }, true, 201);
  }));

  router.get("/time-entries/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const entry = await database.timeEntry.findFirst({ where: { id, contract: { organizationId: identity.organizationId } } });
    if (!entry) return failure(response, request, 404, "NOT_FOUND", "The time entry was not found.");
    success(response, request, entryEntity(entry as EntryRow));
  }));

  router.patch("/time-entries/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const input = parseBody(UpdateInput, request, response);
    if (!input) return;
    const entry = await database.timeEntry.findFirst({ where: { id, contract: { organizationId: identity.organizationId } }, include: { contract: { include: { proposal: { select: { pricing: true, catalogVersionId: true } } } } } });
    if (!entry) return failure(response, request, 404, "NOT_FOUND", "The time entry was not found.");
    if (entry.invoiceId) return failure(response, request, 409, "CONFLICT", "Invoiced time entries cannot be changed.");
    const nextHours = input.hours ?? hoursOf(entry.hours);
    let terms: { capHours: number | null };
    try {
      terms = (await termsFor(database, entry.contract as ContractRow)).terms;
    } catch (error) {
      if (error instanceof BillingScheduleError) return failure(response, request, 409, "CONFLICT", error.message);
      throw error;
    }
    const requested = hundredths(nextHours);
    const result = await database.$transaction(async (transaction) => {
      await lockContract(transaction, entry.contractId);
      const current = await transaction.timeEntry.findFirst({ where: { id }, include: { contract: true } });
      if (!current || current.invoiceId) return { updated: null, logged: 0, conflict: true };
      const logged = await loggedHundredths(transaction, entry.contractId, id);
      if (terms.capHours != null && logged + requested > hundredths(terms.capHours)) return { updated: null, logged, conflict: false };
      const updated = await transaction.timeEntry.update({
        where: { id },
        data: {
          ...(input.date ? { date: new Date(`${input.date}T00:00:00.000Z`) } : {}),
          ...(input.hours != null ? { hours: new PrismaRuntime.Decimal(input.hours.toFixed(2)) } : {}),
          ...(input.description != null ? { description: input.description } : {}),
          ...(input.billable != null ? { billable: input.billable } : {}),
        },
      });
      return { updated, logged, conflict: false };
    });
    if (result.conflict) return failure(response, request, 409, "CONFLICT", "Invoiced time entries cannot be changed.");
    if (!result.updated) return failure(response, request, 409, "HOUR_CAP_EXCEEDED", capMessage(terms.capHours as number, result.logged, requested));
    success(response, request, entryEntity(result.updated as EntryRow), true);
  }));

  router.delete("/time-entries/:id", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const entry = await database.timeEntry.findFirst({ where: { id, contract: { organizationId: identity.organizationId } } });
    if (!entry) return failure(response, request, 404, "NOT_FOUND", "The time entry was not found.");
    if (entry.invoiceId) return failure(response, request, 409, "CONFLICT", "Invoiced time entries cannot be deleted.");
    await database.timeEntry.delete({ where: { id } });
    success(response, request, { id, deleted: true }, true);
  }));

  router.get("/contracts/:id/hours-remaining", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const contract = await loadContract(database, id, identity.organizationId);
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    let terms: { capHours: number | null; rateMinor: number; currency: string };
    try {
      terms = (await termsFor(database, contract)).terms;
    } catch (error) {
      if (error instanceof BillingScheduleError) return failure(response, request, 409, "CONFLICT", error.message);
      throw error;
    }
    const logged = await loggedHundredths(database, id);
    success(response, request, {
      contractId: id,
      capHours: terms.capHours,
      loggedHours: fromHundredths(logged),
      remainingHours: terms.capHours == null ? null : fromHundredths(hundredths(terms.capHours) - logged),
      rate: { amountMinor: terms.rateMinor, currency: terms.currency },
    });
  }));

  router.post("/contracts/:id/invoice-hours", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write", true);
    if (!identity) return;
    const id = parseId(request.params.id, request, response);
    if (!id) return;
    const input = parseBody(InvoiceHoursInput, request, response);
    if (!input) return;
    const contract = await loadContract(database, id, identity.organizationId);
    if (!contract) return failure(response, request, 404, "NOT_FOUND", "The contract was not found.");
    const pricing = contract.proposal.pricing as { model?: string } | null;
    if (pricing?.model !== "hourly" && pricing?.model !== "capped_hours") {
      return failure(response, request, 409, "CONFLICT", "Hour invoices apply to hourly and capped-hour contracts.");
    }
    let catalog: Awaited<ReturnType<typeof loadCatalogForVersion>>;
    let terms: { capHours: number | null; rateMinor: number; currency: string };
    try {
      const loaded = await termsFor(database, contract);
      catalog = loaded.catalog;
      terms = loaded.terms;
    } catch (error) {
      if (error instanceof BillingScheduleError) return failure(response, request, 409, "CONFLICT", error.message);
      throw error;
    }
    const from = new Date(`${input.from}T00:00:00.000Z`);
    const to = new Date(`${input.to}T00:00:00.000Z`);
    const result = await database.$transaction(async (transaction) => {
      await lockContract(transaction, id);
      const entries = await transaction.timeEntry.findMany({
        where: { contractId: id, invoiceId: null, billable: true, date: { gte: from, lte: to } },
        orderBy: { id: "asc" },
      });
      if (entries.length === 0) return { invoice: null, entries, reason: "empty" as const };
      const totalHundredths = entries.reduce((sum, entry) => sum + hundredths(hoursOf(entry.hours)), 0);
      const amountMinor = Math.round(totalHundredths * terms.rateMinor / 100);
      if (amountMinor <= 0) return { invoice: null, entries, reason: "zero" as const };
      const created = await transaction.invoice.create({
        data: {
          contractId: id,
          amountMinor,
          currency: terms.currency,
          status: catalog.invoicePolicy.initialStatus,
          dueDate: signingInvoiceDue(catalog),
        },
      });
      const claimed = await transaction.timeEntry.updateMany({ where: { id: { in: entries.map((entry) => entry.id) }, invoiceId: null }, data: { invoiceId: created.id } });
      if (claimed.count !== entries.length) throw new Error("TIME_ENTRY_CLAIM_CONFLICT");
      if (supportsCredits(transaction) && pricing?.model) {
        const applied = await applyOpenCredits(transaction, {
          organizationId: contract.organizationId,
          contractId: id,
          invoiceId: created.id,
          pricingModel: pricing.model,
          currency: terms.currency,
          amountMinor,
        });
        created.amountMinor = applied.amountMinor;
      }
      return { invoice: created, entries, totalHundredths, reason: null };
    });
    if (result.reason === "empty") return failure(response, request, 409, "CONFLICT", "No unbilled billable hours in that date range.");
    if (result.reason === "zero") return failure(response, request, 409, "CONFLICT", "The unbilled hours total zero at the catalog rate.");
    const invoice = result.invoice;
    if (!invoice) throw new Error("Invoice transaction did not return an invoice.");
    success(response, request, {
      id: invoice.id,
      contractId: invoice.contractId,
      amount: { amountMinor: invoice.amountMinor, currency: invoice.currency },
      status: invoice.status,
      dueDate: dateOnly(invoice.dueDate),
      entryIds: result.entries.map((entry) => entry.id),
      hours: fromHundredths(result.totalHundredths),
      rate: { amountMinor: terms.rateMinor, currency: terms.currency },
    }, true, 201);
  }));

  return router;
}
