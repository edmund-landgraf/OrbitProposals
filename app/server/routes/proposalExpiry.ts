import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { ExpiryError, expiryView, loadExpiryConfig } from "../proposalExpiry.js";

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

const ExtendBody = z.object({ days: z.number().int().positive().optional(), reason: z.string().trim().min(1).max(500).optional() }).strict();

export function createProposalExpiryRouter({ prisma, now = () => new Date() }: { prisma: PrismaClient; now?: () => Date }): Router {
  const router = Router();
  const wrap = (handler: (request: Request, response: Response) => Promise<void>) => run(async (request, response) => {
    try { await handler(request, response); }
    catch (error) {
      if (error instanceof ExpiryError) throw new HttpError(error.status, error.code, error.message);
      throw error;
    }
  });

  const loadVisible = async (request: Request, principal: Principal) => {
    const proposal = await prisma.proposal.findUnique({ where: { id: z.string().uuid().parse(param(request, "id")) } });
    if (!proposal || !canSeeProposal(principal, proposal)) throw new HttpError(404, "NOT_FOUND", "The proposal was not found.");
    return proposal;
  };

  router.get("/proposals/:id/expiry", wrap(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:read");
    const proposal = await loadVisible(request, principal);
    const config = await loadExpiryConfig(prisma);
    ok(request, response, { proposalId: proposal.id, expires: false, ...expiryView(proposal.validUntil, now(), config) });
  }));

  router.post("/proposals/:id/expiry/extend", wrap(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write", { staff: true });
    const body = ExtendBody.parse(request.body ?? {});
    const proposal = await loadVisible(request, principal);
    if (proposal.status === "closed") throw new HttpError(409, "CONFLICT", "A closed proposal cannot be extended.");
    const config = await loadExpiryConfig(prisma);
    const at = now();
    const view = { proposalId: proposal.id, expires: false, ...expiryView(null, at, config) };
    // Proposals do not expire. A stored deadline is cleared; days does not write a new one.
    if (!proposal.validUntil) { ok(request, response, view, false); return; }
    await prisma.$transaction(async (tx) => {
      await tx.proposal.update({ where: { id: proposal.id }, data: { validUntil: null } });
      await writeAudit(tx, {
        organizationId: proposal.organizationId,
        actorUserId: principal.userId,
        operation: "proposal.expiry.clear",
        method: request.method,
        path: request.path,
        recordType: "Proposal",
        recordId: proposal.id,
        requestId: requestId(request),
        input: { proposalId: proposal.id, previousValidUntil: proposal.validUntil?.toISOString() ?? null, validUntil: null, expires: false, reason: body.reason ?? null },
        statusCode: 200,
      });
    });
    ok(request, response, view, true);
  }));

  return router;
}
