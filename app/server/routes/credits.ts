import { randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma as defaultPrisma } from "../db.js";
import {
  CreditError,
  applyOpenCredits,
  presentCredit,
  supportsCredits,
  voidCredit,
  type ContractCreditRow,
} from "../credits.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import type {} from "../sessionTypes.js";

export type CreditAuth = {
  userId: string;
  organizationId: string;
  role: "prospect" | "client" | "staff";
  scopes?: readonly string[];
};

export type CreditRouterOptions = {
  prisma?: PrismaClient;
  authorize?: (request: Request, requiredScope: string, staffOnly?: boolean) => CreditAuth | null;
};

const UUID = z.string().uuid();
const ApplyInput = z.object({ invoiceId: UUID }).strict();

function requestId(request: Request): string {
  const candidate = request.header("x-request-id");
  return UUID.safeParse(candidate).success ? candidate! : randomUUID();
}

function success(response: Response, request: Request, entity: unknown, changed = false, status = 200): void {
  response.status(status).json({ ok: true, ...(changed ? { changed: true } : {}), entity, warnings: [], links: {}, requestId: requestId(request) });
}

function failure(response: Response, request: Request, status: number, code: string, message: string): void {
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, requestId: requestId(request) });
}

function defaultAuthorize(request: Request, _scope: string, staffOnly = false): CreditAuth | null {
  const candidate = (request as Request & { billingProjectsAuth?: CreditAuth }).billingProjectsAuth;
  if (!candidate || (staffOnly && candidate.role !== "staff") || (!staffOnly && candidate.role === "prospect")) return null;
  return candidate;
}

function auth(options: CreditRouterOptions, request: Request, response: Response, scope: string): CreditAuth | null {
  const identity = (options.authorize ?? defaultAuthorize)(request, scope, true);
  if (!identity || identity.role !== "staff") {
    failure(response, request, 403, "FORBIDDEN", "Staff authorization is required.");
    return null;
  }
  if (identity.scopes && !scopeAllows(identity.scopes, scope)) {
    failure(response, request, 403, "SCOPE_REQUIRED", `The ${scope} scope is required.`);
    return null;
  }
  return identity;
}

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch((error: unknown) => {
    if (error instanceof CreditError) {
      failure(response, request, error.statusCode, error.code, error.message);
      return;
    }
    next(error);
  });
}

function pricingModel(pricing: unknown): string {
  if (pricing && typeof pricing === "object" && "model" in pricing && typeof pricing.model === "string") return pricing.model;
  return "";
}

export function createCreditsRouter(options: CreditRouterOptions = {}): Router {
  const database = options.prisma ?? defaultPrisma;
  const router = Router();

  router.get("/credits", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:read");
    if (!identity) return;
    if (!supportsCredits(database)) return failure(response, request, 500, "INTERNAL_ERROR", "Credits are not available.");
    const requested = typeof request.query.organizationId === "string" ? request.query.organizationId : identity.organizationId;
    if (!UUID.safeParse(requested).success) return failure(response, request, 400, "VALIDATION_FAILED", "organizationId must be a UUID.");
    if (requested !== identity.organizationId) return failure(response, request, 403, "FORBIDDEN", "Staff can list credits for their organization.");
    const now = new Date();
    const credits = await database.contractCredit.findMany({
      where: { organizationId: requested },
      orderBy: { issuedAt: "desc" },
      take: 100,
    });
    success(response, request, { items: credits.map((credit) => presentCredit(credit as ContractCreditRow, now)) });
  }));

  router.post("/credits/:id/apply", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write");
    if (!identity) return;
    if (!UUID.safeParse(request.params.id).success) return failure(response, request, 400, "VALIDATION_FAILED", "The id must be a UUID.");
    const parsed = ApplyInput.safeParse(request.body ?? {});
    if (!parsed.success) return failure(response, request, 400, "VALIDATION_FAILED", "invoiceId must be a UUID.");
    if (!supportsCredits(database)) return failure(response, request, 500, "INTERNAL_ERROR", "Credits are not available.");
    const creditId = String(request.params.id);
    const invoice = await database.invoice.findFirst({
      where: { id: parsed.data.invoiceId, contract: { organizationId: identity.organizationId } },
      include: { contract: { include: { proposal: true } } },
    });
    if (!invoice) return failure(response, request, 404, "NOT_FOUND", "The invoice was not found.");
    if (invoice.status === "void" || invoice.status === "paid") return failure(response, request, 409, "CONFLICT", "A credit can be applied to a draft or sent invoice.");
    const model = pricingModel(invoice.contract.proposal?.pricing);
    const result = await database.$transaction((transaction) => applyOpenCredits(transaction, {
      organizationId: identity.organizationId,
      contractId: invoice.contractId,
      invoiceId: invoice.id,
      pricingModel: model,
      currency: invoice.currency,
      amountMinor: invoice.amountMinor,
      creditId,
    }));
    const credit = await database.contractCredit.findFirst({ where: { id: creditId } });
    success(response, request, {
      credit: credit ? presentCredit(credit as ContractCreditRow) : null,
      invoiceId: invoice.id,
      amount: { amountMinor: result.amountMinor, currency: invoice.currency },
      applied: result.applied,
    }, true);
  }));

  router.post("/credits/:id/void", asyncRoute(async (request, response) => {
    const identity = auth(options, request, response, "billing:write");
    if (!identity) return;
    if (!UUID.safeParse(request.params.id).success) return failure(response, request, 400, "VALIDATION_FAILED", "The id must be a UUID.");
    if (!supportsCredits(database)) return failure(response, request, 500, "INTERNAL_ERROR", "Credits are not available.");
    const credit = await voidCredit(database, String(request.params.id), identity.organizationId);
    success(response, request, presentCredit(credit), true);
  }));

  return router;
}
