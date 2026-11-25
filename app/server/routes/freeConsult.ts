import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { ConsultError, createConsultIntake } from "../freeConsult.js";

type Principal = { userId: string; organizationId?: string; membershipRole?: string; isAdmin: boolean; scopes: string[] | null };

const resolvePrincipal = async (prisma: PrismaClient, request: Request): Promise<Principal | undefined> => {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (!token) return undefined;
    const stored = await prisma.mcpToken.findFirst({
      where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      include: { client: true, user: { include: { memberships: true } } },
    });
    if (!stored?.userId || !stored.user) return undefined;
    const membership = stored.user.memberships.find((item) => item.status === "active");
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    return { userId: stored.userId, organizationId: stored.client.organizationId ?? membership?.organizationId, membershipRole: membership?.role, isAdmin: Boolean(stored.user.isAdmin), scopes };
  }
  const userId = request.session?.userId;
  if (!userId) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) return undefined;
  const membership = user.memberships.find((item) => item.status === "active");
  return { userId, organizationId: membership?.organizationId, membershipRole: membership?.role, isAdmin: Boolean(user.isAdmin), scopes: null };
};

const isStaff = (principal: Principal) => principal.isAdmin || principal.membershipRole === "staff";

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const param = (request: Request, name: string) => {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200) =>
  response.status(status).json({ ok: true, changed, entity, warnings: [], links: {}, requestId: requestId(request) });
const fail = (request: Request, response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, requestId: requestId(request) });

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
  try { await handler(request, response); }
  catch (error) {
    if (error instanceof HttpError) { fail(request, response, error.status, error.code, error.message); return; }
    if (error instanceof z.ZodError) { fail(request, response, 400, "VALIDATION_FAILED", "The request body is invalid."); return; }
    console.error(error);
    fail(request, response, 500, "INTERNAL_ERROR", "The request could not be completed.");
  }
};

const authorize = async (prisma: PrismaClient, request: Request, scope: string, options: { staff?: boolean } = {}): Promise<Principal> => {
  const principal = await resolvePrincipal(prisma, request);
  if (!principal) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  if (principal.scopes && !scopeAllows(principal.scopes, scope)) throw new HttpError(403, "SCOPE_REQUIRED", `The ${scope} scope is required.`);
  if (options.staff && !isStaff(principal)) throw new HttpError(403, "FORBIDDEN", "Staff authorization is required.");
  return principal;
};

const canSeeProposal = (principal: Principal, proposal: { ownerId: string; organizationId: string | null }) =>
  isStaff(principal) || proposal.ownerId === principal.userId || Boolean(principal.organizationId && proposal.organizationId === principal.organizationId);

async function writeAudit(prisma: PrismaClient | Prisma.TransactionClient, event: { organizationId: string | null; actorUserId: string | null; operation: string; method: string; path: string; recordType: string; recordId: string; requestId: string; input: Record<string, unknown>; statusCode: number }) {
  const previous = await prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const previousHash = previous?.hash ?? null;
  await prisma.auditEvent.create({
    data: {
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      tokenId: null,
      operation: event.operation,
      method: event.method,
      path: event.path,
      recordType: event.recordType,
      recordId: event.recordId,
      requestId: event.requestId,
      inputRedacted: event.input as Prisma.InputJsonValue,
      statusCode: event.statusCode,
      previousHash,
      hash: createHash("sha256").update(JSON.stringify({ previousHash, operation: event.operation, recordId: event.recordId, ...event.input })).digest("hex"),
    },
  });
}

const IntakeBody = z.object({
  offeringCode: z.string().trim().min(1).max(80).optional(),
  topic: z.string().trim().min(1).max(200),
  details: z.string().trim().max(4000).optional(),
}).strict();

const offeringView = (row: { code: string; label: string; description: string; amountMinor: number; currency: string; durationMinutes: number; perClientLimit: number | null }) => ({
  code: row.code, label: row.label, description: row.description, price: { amountMinor: row.amountMinor, currency: row.currency }, durationMinutes: row.durationMinutes, perClientLimit: row.perClientLimit,
});

export function createFreeConsultRouter({ prisma, defaultOfferingCode = "free_consult" }: { prisma: PrismaClient; defaultOfferingCode?: string }): Router {
  const router = Router();

  router.get("/consult-offerings", run(async (request, response) => {
    const rows = await prisma.consultOffering.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    ok(request, response, { items: rows.map(offeringView) });
  }));

  router.post("/consult-intakes", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write");
    const raw = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    if ("pricing" in raw || "amountMinor" in raw || "hours" in raw || "price" in raw) throw new HttpError(403, "FORBIDDEN", "The consult price comes from the offering. Send only the topic and details.");
    const body = IntakeBody.parse(raw);
    let result;
    try {
      result = await createConsultIntake(prisma, { ...body, userId: principal.userId, organizationId: principal.organizationId ?? null, defaultOfferingCode });
    } catch (error) {
      if (error instanceof ConsultError) throw new HttpError(error.status, error.code, error.message);
      throw error;
    }
    await writeAudit(prisma, { organizationId: principal.organizationId ?? null, actorUserId: principal.userId, operation: "consult.intake.create", method: request.method, path: request.path, recordType: "Proposal", recordId: result.proposal.id, requestId: requestId(request), input: { offeringCode: result.offering.code, intakeId: result.intake.id, proposalId: result.proposal.id }, statusCode: 201 });
    ok(request, response, {
      intake: { id: result.intake.id, offeringCode: result.intake.offeringCode, topic: result.intake.topic, scheduledAt: null, bookingReference: null, createdAt: result.intake.createdAt.toISOString() },
      proposal: { id: result.proposal.id, title: result.proposal.title, status: result.proposal.status, reviewState: result.proposal.reviewState, pricing: result.proposal.pricing },
      offering: offeringView(result.offering),
      remaining: result.remaining,
    }, true, 201);
  }));

  router.get("/consult-intakes", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:read");
    const where = isStaff(principal) ? {} : principal.organizationId ? { organizationId: principal.organizationId } : { userId: principal.userId };
    const items = await prisma.consultIntake.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
    ok(request, response, { items });
  }));

  return router;
}
