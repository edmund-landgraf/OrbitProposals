import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { loadFollowUpQueue } from "../followUpQueue.js";

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


const QueueQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });

export function createFollowUpQueueRouter({ prisma, now = () => new Date() }: { prisma: PrismaClient; now?: () => Date }): Router {
  const router = Router();

  router.get("/admin/follow-up-queue", run(async (request, response) => {
    await authorize(prisma, request, "proposals:read", { staff: true });
    const query = QueueQuery.parse(request.query ?? {});
    const result = await loadFollowUpQueue(prisma, { now: now(), limit: query.limit });
    ok(request, response, { items: result.items, reasons: result.reasons.filter((reason) => reason.active).map((reason) => ({ code: reason.code, label: reason.label })) });
  }));

  return router;
}
