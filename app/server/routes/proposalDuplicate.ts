import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { DuplicateError, duplicateProposal } from "../proposalDuplicate.js";
import { proposalPortalUrl } from "../publicUrls.js";

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
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200, extra: { links?: Record<string, string>; warnings?: Array<{ code: string; message: string }> } = {}) =>
  response.status(status).json({ ok: true, changed, entity, warnings: extra.warnings ?? [], links: extra.links ?? {}, requestId: requestId(request) });
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

const DuplicateBody = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  engagement: z.string().trim().min(1).max(40).optional(),
  reason: z.string().trim().max(1000).optional(),
}).strict();

export function createProposalDuplicateRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  router.post("/proposals/:id/duplicate", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:write");
    const raw = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    if ("pricing" in raw || "amountMinor" in raw || "hours" in raw || "price" in raw) throw new HttpError(403, "FORBIDDEN", "A copy keeps the source price, or waits for staff to price it. Price and hours cannot be sent here.");
    const body = DuplicateBody.parse(raw);
    const id = param(request, "id");
    const source = await prisma.proposal.findUnique({ where: { id }, select: { ownerId: true, organizationId: true } });
    if (!source || !canSeeProposal(principal, source)) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
    let result;
    try {
      result = await duplicateProposal(prisma, { sourceId: id, actorUserId: principal.userId, ...body });
    } catch (error) {
      if (error instanceof DuplicateError) throw new HttpError(error.status, error.code, error.message);
      throw error;
    }
    await writeAudit(prisma, { organizationId: result.copy.organizationId, actorUserId: principal.userId, operation: "proposal.duplicate", method: request.method, path: request.path, recordType: "Proposal", recordId: result.copy.id, requestId: requestId(request), input: { sourceProposalId: id, engagementChanged: result.pendingStaffPrice, reason: body.reason ?? "" }, statusCode: 201 });
    ok(request, response, {
      proposal: { id: result.copy.id, title: result.copy.title, engagement: result.copy.engagement, pricingModel: result.copy.pricingModel, pricing: result.copy.pricing, status: result.copy.status, reviewState: result.copy.reviewState },
      sourceProposalId: id,
      pendingStaffPrice: result.pendingStaffPrice,
      copied: result.counts,
    }, true, 201, {
      links: { portal: proposalPortalUrl(result.copy.id) },
      warnings: result.pendingStaffPrice ? [{ code: "PENDING_STAFF_PRICE", message: "The engagement changed, so the copy has no amount until staff price it." }] : [],
    });
  }));

  router.get("/proposals/:id/lineage", run(async (request, response) => {
    const principal = await authorize(prisma, request, "proposals:read");
    const id = param(request, "id");
    const proposal = await prisma.proposal.findUnique({ where: { id }, select: { ownerId: true, organizationId: true } });
    if (!proposal || !canSeeProposal(principal, proposal)) throw new HttpError(404, "NOT_FOUND", "Proposal not found.");
    const [source, copies] = await Promise.all([
      prisma.proposalLineage.findUnique({ where: { proposalId: id } }),
      prisma.proposalLineage.findMany({ where: { sourceProposalId: id }, orderBy: { createdAt: "asc" } }),
    ]);
    ok(request, response, { sourceProposalId: source?.sourceProposalId ?? null, copies: copies.map((row) => ({ proposalId: row.proposalId, reason: row.reason, engagementChanged: row.engagementChanged, createdAt: row.createdAt.toISOString() })) });
  }));

  return router;
}
