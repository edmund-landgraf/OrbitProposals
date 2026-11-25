import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { listTraces, recordTrace } from "../agentTrace.js";

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
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

type BearerActor = { tokenId: string; mcpClientId: string; userId: string | null; organizationId: string | null; isAdmin: boolean; membershipRole?: string; scopes: string[] };

async function bearerActor(prisma: PrismaClient, request: Request): Promise<BearerActor | undefined> {
  const header = request.header("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) return undefined;
  const stored = await prisma.mcpToken.findFirst({
    where: { tokenHash: createHash("sha256").update(raw).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { client: true, user: { include: { memberships: true } } },
  });
  if (!stored) return undefined;
  const membership = stored.user?.memberships.find((item) => item.status === "active" && (!stored.client.organizationId || item.organizationId === stored.client.organizationId));
  const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  return { tokenId: stored.id, mcpClientId: stored.clientId, userId: stored.userId, organizationId: stored.client.organizationId ?? membership?.organizationId ?? null, isAdmin: Boolean(stored.user?.isAdmin), membershipRole: membership?.role, scopes };
}

async function requireStaff(prisma: PrismaClient, request: Request) {
  const actor = await bearerActor(prisma, request);
  if (actor) {
    if (!scopeAllows(actor.scopes, "proposals:read")) throw new HttpError(403, "SCOPE_REQUIRED", "The proposals:read scope is required.");
    if (!(actor.isAdmin || actor.membershipRole === "staff")) throw new HttpError(403, "FORBIDDEN", "Staff authorization is required.");
    return;
  }
  const userId = request.session?.userId;
  if (!userId) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  if (!(user.isAdmin || user.memberships.some((item) => item.status === "active" && item.role === "staff"))) throw new HttpError(403, "FORBIDDEN", "Staff authorization is required.");
}

const TraceBody = z.object({
  toolName: z.string().min(1).max(200),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  isError: z.boolean().optional(),
  errorMessage: z.string().max(10000).nullable().optional(),
  durationMs: z.number().min(0).max(86_400_000),
  agentName: z.string().max(200).nullable().optional(),
  sessionRef: z.string().max(200).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
}).strict();

const ListQuery = z.object({
  tool: z.string().min(1).max(200).optional(),
  clientId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  errors: z.enum(["true", "false"]).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

const view = (row: { id: string; occurredAt: Date; mcpClientId: string | null; tokenId: string | null; userId: string | null; organizationId: string | null; agentName: string | null; sessionRef: string | null; toolName: string; input: unknown; output: unknown; isError: boolean; errorMessage: string | null; durationMs: number }) => ({
  id: row.id, occurredAt: row.occurredAt.toISOString(), mcpClientId: row.mcpClientId, tokenId: row.tokenId, userId: row.userId, organizationId: row.organizationId,
  agentName: row.agentName, sessionRef: row.sessionRef, toolName: row.toolName, input: row.input, output: row.output, isError: row.isError, errorMessage: row.errorMessage, durationMs: row.durationMs,
});

export function createAgentTracesRouter({ prisma }: { prisma: PrismaClient }): Router {
  const router = Router();

  // Written by unwh-mcp after each tool call, with the caller's own bearer token. The token decides who the trace belongs to.
  router.post("/agent-traces", run(async (request, response) => {
    const actor = await bearerActor(prisma, request);
    if (!actor) throw new HttpError(401, "AUTH_REQUIRED", "A valid bearer token is required.");
    const body = TraceBody.parse(request.body ?? {});
    const row = await recordTrace(prisma, actor, { ...body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined });
    ok(request, response, { id: row.id }, true, 201);
  }));

  router.get("/admin/agent-traces", run(async (request, response) => {
    await requireStaff(prisma, request);
    const query = ListQuery.parse(request.query ?? {});
    const result = await listTraces(prisma, {
      toolName: query.tool, mcpClientId: query.clientId, userId: query.userId,
      isError: query.errors === undefined ? undefined : query.errors === "true",
      before: query.before ? new Date(query.before) : undefined, limit: query.limit,
    });
    ok(request, response, { items: result.items.map(view), nextBefore: result.nextBefore });
  }));

  router.get("/admin/agent-traces/:traceId", run(async (request, response) => {
    await requireStaff(prisma, request);
    const traceId = z.string().uuid().parse(request.params.traceId);
    const row = await prisma.agentTrace.findUnique({ where: { id: traceId } });
    if (!row) throw new HttpError(404, "NOT_FOUND", "Trace not found.");
    ok(request, response, view(row));
  }));

  return router;
}
