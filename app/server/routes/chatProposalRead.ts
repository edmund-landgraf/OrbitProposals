import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { CursorQuerySchema, DateSchema, EngagementKindSchema, IdSchema, ProposalDocumentSchema, RecordStatusSchema } from "../../packages/shapes/src/index.js";
import { TimelineCreateSchema, TimelineWriteSchema, milestoneTableRow, milestoneViews, planTimelineWrite } from "../proposalTimeline.js";
import { markWrittenParts, writtenKeysForPatch } from "../proposalWrittenState.js";
import { proposalLinks, proposalPortalUrl } from "../publicUrls.js";
import { prismaCompletionStore } from "../proposalCompletion.js";
import { BillingScheduleError } from "../../packages/shapes/src/billingSchedule.js";
import { loadActiveCatalog, parseCatalogPricing } from "../catalog.js";
import { duplicatePricing } from "../proposalDuplicate.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { logEvent } from "../../shared/log.js";
import { summarizeViews } from "../proposalViews.js";
import { guidanceContext } from "../guidancePlaybook.js";
import { noteGuidanceAction, safeGuidanceTurn } from "../guidanceTurn.js";
import { completeProposalTurn, modelFromEnv, runProposalAgent, type AgentTurn } from "../proposalAgent.js";
import { ReviewError } from "../proposalReview.js";
import { changedProposalFields, guardProposalEdit, partsForFields, recordCommercialEdit } from "./proposalReview.js";

export type AuthContext = { userId: string; organizationId?: string; role?: "prospect" | "client" | "staff"; scopes?: string[] };
export type ProposalModel = (history: { role: "user" | "assistant" | "human" | "system"; content: string }[]) => Promise<AgentTurn>;
export type ChatProposalReadOptions = { prisma?: PrismaClient; resolveAuth?: (request: Request) => AuthContext | undefined | Promise<AuthContext | undefined>; proposalModel?: ProposalModel };
type AuthenticatedRequest = Request & { auth?: AuthContext };
type JsonRecord = Record<string, unknown>;

const AgentSchema = z.enum(["proposal", "contract", "project_manager"]);
const ChatRoleSchema = z.enum(["user", "assistant", "human", "system"]);
const CreateChatSchema = z.object({ agent: AgentSchema.default("proposal"), proposalId: IdSchema.nullable().optional() }).strict();
const CreateMessageSchema = z.object({ role: ChatRoleSchema.default("user"), content: z.string().min(1).max(4_000), toolCallId: IdSchema.nullable().optional() }).strict();
const PublicSessionSchema = z.object({ email: z.string().email().optional() }).strict();
const PublicSubmitSchema = z.object({ email: z.string().email(), name: z.string().trim().min(1).max(200).optional() }).strict();
const EscalateSchema = z.object({ reason: z.string().min(1).max(2_000) }).strict();
const ProposalScopeInputSchema = z.object({
  summary: z.string().min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  assumptions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
}).strict();
const ProposalFieldsSchema = z.object({
  title: z.string().min(1).max(300),
  engagement: EngagementKindSchema,
  scope: ProposalScopeInputSchema,
  timeline: TimelineCreateSchema,
  pricing: z.object({ model: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/) }).passthrough(),
}).strict();
const ProposalInputSchema = ProposalFieldsSchema.extend({
  timeline: TimelineCreateSchema.default({ startDate: null, targetDate: null, milestones: [] }),
});
const ProposalPatchSchema = ProposalFieldsSchema.partial().extend({
  status: RecordStatusSchema.optional(),
  timeline: TimelineWriteSchema.optional(),
}).strict();

const asObject = (value: Prisma.JsonValue | null | undefined): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const inputJson = (value: JsonRecord) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const dateOnly = (value: unknown): string | null => { if (value === null || value === undefined || value === "") return null; const d = new Date(String(value)); return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10); };
const requestId = (request: Request) => { const id = request.header("x-request-id"); return id && IdSchema.safeParse(id).success ? id : randomUUID(); };
const publicTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const publicCookie = "unw_public_proposal";
const publicWorkspaceTtlMs = 30 * 24 * 60 * 60 * 1000;
const publicCreateWindowMs = 60 * 60 * 1000;
const publicMessageWindowMs = 60 * 1000;
const publicCreateLimit = 5;
const publicMessageIpLimit = 30;
const publicMessageSessionLimit = 50;
const publicRate = new Map<string, number[]>();
const clientIp = (request: Request) => request.ip || request.socket.remoteAddress || "unknown";
const allowRate = (key: string, limit: number, windowMs: number) => { const now = Date.now(); const kept = (publicRate.get(key) ?? []).filter((time) => now - time < windowMs); if (kept.length >= limit) { publicRate.set(key, kept); return false; } kept.push(now); publicRate.set(key, kept); return true; };
const cookieOptions = { httpOnly: true, secure: process.env.UNWH_COOKIE_SECURE !== "false", sameSite: "lax" as const, path: "/", maxAge: publicWorkspaceTtlMs };
const cookieValue = (request: Request, name: string) => request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const publicTokenFromRequest = (request: Request) => request.header("x-unw-public-token") ?? cookieValue(request, publicCookie);

function success(response: Response, request: Request, entity: unknown, status = 200, changed?: boolean, extra?: { warnings?: Array<{ code: string; message: string; path?: string }>; links?: Record<string, string> }) {
  response.status(status).json({
    ok: true,
    ...(changed === undefined ? {} : { changed }),
    entity,
    warnings: extra?.warnings ?? [],
    links: extra?.links ?? proposalLinks(entity),
    requestId: requestId(request),
  });
}
function failure(response: Response, request: Request, status: number, code: string, message: string, details?: unknown[]) { if (code === "VALIDATION_FAILED") console.warn("VALIDATION_FAILED", { message, details: details ?? [] }); response.status(status).json({ ok: false, code, message, retryable: status >= 500 || status === 429, ...(details ? { details } : {}), requestId: requestId(request) }); }
function parseBody<T>(schema: z.ZodType<T>, request: Request, response: Response): T | undefined { const parsed = schema.safeParse(request.body); if (parsed.success) return parsed.data; failure(response, request, 400, "VALIDATION_FAILED", "The request body is invalid.", parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message }))); return undefined; }
function parseId(request: Request, response: Response) { const parsed = IdSchema.safeParse(request.params.id); if (parsed.success) return parsed.data; failure(response, request, 400, "VALIDATION_FAILED", "The id must be a UUID."); return undefined; }
function isStaff(auth: AuthContext) { return auth.role === "staff"; }
function hasScope(auth: AuthContext, scope: string) { return isStaff(auth) || (auth.scopes != null && scopeAllows(auth.scopes, scope)); }
function canSee(auth: AuthContext, ownerId: string | null, organizationId?: string | null) { return isStaff(auth) || ownerId === auth.userId || (!!auth.organizationId && organizationId === auth.organizationId); }

async function canSeeProposal(db: PrismaClient, auth: AuthContext, proposal: { id: string; ownerId: string | null; organizationId?: string | null }) {
  if (canSee(auth, proposal.ownerId, proposal.organizationId)) return true;
  const invite = await db.proposalGuestInvite.findFirst({ where: { proposalId: proposal.id, userId: auth.userId, status: "active" }, select: { id: true } });
  return Boolean(invite);
}

async function defaultAuth(request: Request, db: PrismaClient): Promise<AuthContext | undefined> {
  if (request.session?.userId) {
    const userId = request.session.userId;
    const [membership, invite] = await Promise.all([
      db.membership.findFirst({ where: { userId, status: "active", role: { in: ["client", "staff"] } }, select: { id: true } }),
      db.proposalGuestInvite.findFirst({ where: { userId, status: "active" }, select: { id: true } }),
    ]);
    const scopes = !membership && invite ? ["proposals:read"] : ["proposals:read", "proposals:write"];
    return { userId, organizationId: request.session.organizationId, role: "client", scopes };
  }
  const authorization = request.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (!token) return undefined;
    const stored = await db.mcpToken.findFirst({ where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { client: true, user: { include: { memberships: true } } } });
    if (!stored?.userId || !stored.user) return undefined;
    const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
    const organizationId = stored.client.organizationId ?? stored.user.memberships.find((membership) => membership.status === "active")?.organizationId;
    return { userId: stored.userId, organizationId, role: stored.user.memberships.find((membership) => membership.status === "active")?.role, scopes };
  }
  return undefined;
}
async function auth(request: AuthenticatedRequest, response: Response, options: ChatProposalReadOptions, role?: "staff", scope?: string) {
  const value = await (options.resolveAuth ? options.resolveAuth(request) : request.auth ?? defaultAuth(request, options.prisma!));
  if (!value) { failure(response, request, 401, "AUTH_REQUIRED", "Authentication is required."); return undefined; }
  if (role === "staff" && !isStaff(value)) { failure(response, request, 403, "FORBIDDEN", "Staff authorization is required."); return undefined; }
  if (scope && !hasScope(value, scope)) { failure(response, request, 403, "SCOPE_REQUIRED", `The ${scope} scope is required.`); return undefined; }
  return value;
}

function mapSession(s: { id: string; ownerId: string | null; agent: string; status: string; proposalId: string | null; createdAt: Date; updatedAt: Date }) { return { id: s.id, ownerId: s.ownerId, agent: s.agent, status: s.status, proposalId: s.proposalId, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }; }
function mapMessage(m: { id: string; sessionId: string; role: string; content: string; toolCallId: string | null; createdAt: Date }) { return { id: m.id, sessionId: m.sessionId, role: m.role, content: m.content, toolCallId: m.toolCallId, createdAt: m.createdAt.toISOString() }; }
function mapProposal(p: Prisma.ProposalGetPayload<{ include: { options: true; milestones: true } }>) {
  const scope = asObject(p.scope), timeline = asObject(p.timeline), pricing = asObject(p.pricing);
  return ProposalDocumentSchema.parse({ schemaVersion: 1, id: p.id, organizationId: p.organizationId, ownerId: p.ownerId, title: p.title, engagement: p.engagement, status: p.status,
    scope: { summary: String(scope.summary ?? ""), deliverables: Array.isArray(scope.deliverables) ? scope.deliverables.map(String) : [], assumptions: Array.isArray(scope.assumptions) ? scope.assumptions.map(String) : [], exclusions: Array.isArray(scope.exclusions) ? scope.exclusions.map(String) : [] },
    timeline: { startDate: dateOnly(timeline.startDate), targetDate: dateOnly(timeline.targetDate), milestones: milestoneViews(p.milestones, p.timeline) },
    pricing,
    options: p.options.map((o) => ({ id: o.id, label: o.label, description: o.description, priceDelta: { amountMinor: o.priceDeltaMinor, currency: o.priceCurrency }, selected: o.selected })),
    version: p.version, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() });
}

async function replyToUser(db: PrismaClient, options: ChatProposalReadOptions, session: { agent: string; status: string; proposalId: string | null }, who: AuthContext, id: string, input: { content: string; toolCallId?: string | null }) {
  const history = await db.chatMessage.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" } });
  const message = await db.chatMessage.create({ data: { sessionId: id, role: "user", content: input.content, toolCallId: input.toolCallId ?? null } });
  const configured = options.proposalModel ?? (() => { const config = modelFromEnv(); return config ? (turns: Parameters<ProposalModel>[0]) => completeProposalTurn(turns, config) : undefined; })();
  let content = `Stored. No proposal model is connected yet, so this reply only confirms: ${input.content}`;
  let toolCallId: string | null = null;
  const guidance = session.agent === "proposal" && session.status === "open" && session.proposalId
    ? await safeGuidanceTurn(db, { proposalId: session.proposalId, sessionId: id, userJustSpoke: true })
    : null;
  const moves = guidanceContext(guidance?.suggestedMoves ?? []);
  if (session.agent === "proposal" && session.status === "open" && configured) {
    const outcome = await runProposalAgent({
      history: [...(moves ? [{ role: "system" as const, content: moves }] : []), ...history.map((item) => ({ role: item.role as "user" | "assistant" | "human" | "system", content: item.content }))],
      userContent: input.content,
      complete: configured,
      createProposal: async (draft) => {
        const parsed = ProposalInputSchema.safeParse(draft);
        if (!parsed.success) throw new Error("INVALID_DRAFT");
        const catalog = await loadActiveCatalog(db);
        try { parseCatalogPricing(catalog, parsed.data.engagement, parsed.data.pricing); }
        catch { throw new Error("INVALID_DRAFT"); }
        const created = await db.proposal.create({ data: { ownerId: who.userId, organizationId: who.organizationId ?? null, title: parsed.data.title, engagement: parsed.data.engagement, scope: inputJson(parsed.data.scope), timeline: inputJson(parsed.data.timeline), pricingModel: parsed.data.pricing.model as Prisma.ProposalCreateInput["pricingModel"], pricing: inputJson(parsed.data.pricing), catalogVersionId: catalog.id } });
        await db.chatSession.update({ where: { id }, data: { proposalId: created.id } });
        return { id: created.id, title: created.title };
      },
      escalate: async (reason) => {
        await db.escalation.create({ data: { sessionId: id, reason } });
        await db.chatSession.update({ where: { id }, data: { status: "human_held" } });
      },
      ...(session.proposalId ? { answerAboutProposal: () => proposalPartsAnswer(db, session.proposalId!) } : {}),
    });
    content = outcome.content;
    if (outcome.proposalId || outcome.escalated) toolCallId = randomUUID();
    if (outcome.escalated && session.proposalId) await noteGuidanceAction(db, { proposalId: session.proposalId, sessionId: id, actionTaken: "handoff", chosenMove: "recommend_handoff" });
  } else if (session.agent === "proposal" && session.status === "human_held") {
    content = "A person at Unwhelm has this conversation.";
  }
  const reply = await db.chatMessage.create({ data: { sessionId: id, role: "assistant", content, toolCallId } });
  return { message: mapMessage(message), reply: mapMessage(reply) };
}

/** Plain-language summary of a proposal's parts by state, used to answer "what is still open?" without a handoff. */
export async function proposalPartsAnswer(db: PrismaClient, proposalId: string): Promise<string | null> {
  await prismaCompletionStore(db).ensure(proposalId);
  const [nodes, states] = await Promise.all([
    db.proposalNode.findMany({ where: { proposalId }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }], select: { key: true, clientLabel: true, title: true, stateCode: true } }),
    db.proposalNodeState.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  if (!nodes.length) return null;
  const groups = states.map((state) => ({ label: state.clientLabel, parts: nodes.filter((node) => node.stateCode === state.code).map((node) => node.clientLabel || node.title || node.key) })).filter((group) => group.parts.length);
  const settled = nodes.filter((node) => (states.find((state) => state.code === node.stateCode)?.completionWeight ?? 0) > 0).length;
  return [`${settled} of ${nodes.length} parts are settled.`, ...groups.map((group) => `${group.label}: ${group.parts.join(", ")}.`)].join(" ");
}

export function createChatProposalReadRouter(options: ChatProposalReadOptions = {}) {
  if (!options.prisma) throw new Error("createChatProposalReadRouter requires the existing Prisma client.");
  const db = options.prisma; const router = Router();
  router.post("/public/proposal-sessions", async (req, res) => { const input = parseBody(PublicSessionSchema, req, res); if (!input) return; if (!allowRate(`create:${clientIp(req)}`, publicCreateLimit, publicCreateWindowMs)) return failure(res, req, 429, "RATE_LIMITED", "Too many proposal workspaces have been created from this address."); const token = randomBytes(32).toString("base64url"); const s = await db.chatSession.create({ data: { agent: "proposal", publicTokenHash: publicTokenHash(token), contactEmail: input.email ?? null, expiresAt: new Date(Date.now() + publicWorkspaceTtlMs) } }); res.cookie(publicCookie, token, cookieOptions); success(res, req, { session: mapSession(s), resumePath: "/proposal/resume", expiresInDays: 30 }, 201, true); });
  router.get("/public/proposal-sessions", async (req, res) => { const token = publicTokenFromRequest(req); if (!token) return failure(res, req, 401, "AUTH_REQUIRED", "A proposal resume cookie or token header is required."); const s = await db.chatSession.findFirst({ where: { publicTokenHash: publicTokenHash(token), ownerId: null, agent: "proposal", expiresAt: { gt: new Date() } }, include: { messages: { orderBy: { createdAt: "asc" } } } }); if (!s) return failure(res, req, 404, "NOT_FOUND", "The proposal workspace was not found."); success(res, req, { session: mapSession(s), messages: s.messages.map(mapMessage), submittedAt: s.submittedAt?.toISOString() ?? null }); });
  router.post("/public/proposal-sessions/messages", async (req, res) => { const input = parseBody(CreateMessageSchema.pick({ content: true }), req, res); if (!input) return; const token = publicTokenFromRequest(req); if (!token) return failure(res, req, 401, "AUTH_REQUIRED", "A proposal resume cookie or token header is required."); if (!allowRate(`message:${clientIp(req)}:${publicTokenHash(token)}`, publicMessageIpLimit, publicMessageWindowMs)) return failure(res, req, 429, "RATE_LIMITED", "Too many messages. Please wait before trying again."); const s = await db.chatSession.findFirst({ where: { publicTokenHash: publicTokenHash(token), ownerId: null, agent: "proposal", status: { not: "closed" }, expiresAt: { gt: new Date() } }, include: { _count: { select: { messages: true } } } }); if (!s) return failure(res, req, 404, "NOT_FOUND", "The proposal workspace was not found or is closed."); if (s._count.messages >= publicMessageSessionLimit) return failure(res, req, 429, "RATE_LIMITED", "This proposal workspace has reached its message limit."); const m = await db.chatMessage.create({ data: { sessionId: s.id, role: "user", content: input.content } }); success(res, req, mapMessage(m), 201, true); });
  router.post("/public/proposal-sessions/submit", async (req, res) => { const input = parseBody(PublicSubmitSchema, req, res); if (!input) return; const token = publicTokenFromRequest(req); if (!token) return failure(res, req, 401, "AUTH_REQUIRED", "A proposal resume cookie or token header is required."); const s = await db.chatSession.findFirst({ where: { publicTokenHash: publicTokenHash(token), ownerId: null, agent: "proposal", status: { not: "closed" }, submittedAt: null, expiresAt: { gt: new Date() } } }); if (!s) return failure(res, req, 404, "NOT_FOUND", "The proposal workspace was not found, already submitted, or is closed."); const updated = await db.$transaction(async (tx) => { const session = await tx.chatSession.updateMany({ where: { id: s.id, submittedAt: null }, data: { contactEmail: input.email, status: "human_held", submittedAt: new Date() } }); if (session.count !== 1) throw new Error("SUBMISSION_ALREADY_EXISTS"); await tx.escalation.create({ data: { sessionId: s.id, reason: `Anonymous proposal submission${input.name ? ` from ${input.name}` : ""}` } }); return tx.chatSession.findUniqueOrThrow({ where: { id: s.id } }); }); success(res, req, { session: mapSession(updated), submitted: true, resumePath: "/proposal/resume" }, 200, true); });
  router.post("/chat/sessions", async (req, res) => { const input = parseBody(CreateChatSchema, req, res); if (!input) return; const who = await (options.resolveAuth ? options.resolveAuth(req) : defaultAuth(req, db)); if (input.proposalId) { const p = await db.proposal.findUnique({ where: { id: input.proposalId } }); if (!p || !canSee(who ?? { userId: "" }, p.ownerId, p.organizationId)) return failure(res, req, 404, "NOT_FOUND", "The proposal was not found."); } const s = await db.chatSession.create({ data: { agent: input.agent, proposalId: input.proposalId ?? null, ownerId: who?.userId ?? null } }); success(res, req, mapSession(s), 201, true); });
  router.get("/chat/sessions", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options); if (!who) return; const agent = req.query.agent === undefined ? undefined : AgentSchema.safeParse(req.query.agent); if (agent && !agent.success) return failure(res, req, 400, "VALIDATION_FAILED", "The agent filter is invalid."); const q = CursorQuerySchema.safeParse({ cursor: req.query.cursor, limit: req.query.limit }); if (!q.success) return failure(res, req, 400, "VALIDATION_FAILED", "The pagination query is invalid."); const rows = await db.chatSession.findMany({ where: { ...(isStaff(who) ? {} : { ownerId: who.userId }), ...(agent?.data ? { agent: agent.data } : {}) }, orderBy: { updatedAt: "desc" }, take: q.data.limit + 1, ...(q.data.cursor ? { skip: 1, cursor: { id: q.data.cursor } } : {}) }); const more = rows.length > q.data.limit, items = rows.slice(0, q.data.limit).map(mapSession); success(res, req, { items, nextCursor: more ? items.at(-1)?.id ?? null : null, totalEstimate: null }); });
  router.get("/chat/sessions/:id", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options); const id = parseId(req, res); if (!who || !id) return; const s = await db.chatSession.findUnique({ where: { id } }); if (!s || !canSee(who, s.ownerId)) return failure(res, req, 404, "NOT_FOUND", "The chat session was not found."); success(res, req, mapSession(s)); });
  router.post("/chat/sessions/:id/messages", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:write"); const id = parseId(req, res); const input = parseBody(CreateMessageSchema, req, res); if (!who || !id || !input) return; const s = await db.chatSession.findUnique({ where: { id } }); if (!s || !canSee(who, s.ownerId) || s.status === "closed") return failure(res, req, 404, "NOT_FOUND", "The chat session was not found or is closed."); if (input.role === "human" && !isStaff(who)) return failure(res, req, 403, "FORBIDDEN", "Only staff may create human messages."); if (input.role === "user") { const stored = await replyToUser(db, options, s, who, id, input); success(res, req, stored, 201, true); return; } const m = await db.chatMessage.create({ data: { sessionId: id, role: input.role, content: input.content, toolCallId: input.toolCallId ?? null } }); success(res, req, mapMessage(m), 201, true); });
  router.get("/chat/sessions/:id/messages", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options); const id = parseId(req, res); if (!who || !id) return; const s = await db.chatSession.findUnique({ where: { id } }); if (!s || !canSee(who, s.ownerId)) return failure(res, req, 404, "NOT_FOUND", "The chat session was not found."); const q = CursorQuerySchema.safeParse(req.query); if (!q.success) return failure(res, req, 400, "VALIDATION_FAILED", "The pagination query is invalid."); const rows = await db.chatMessage.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" }, take: q.data.limit + 1, ...(q.data.cursor ? { skip: 1, cursor: { id: q.data.cursor } } : {}) }); const more = rows.length > q.data.limit, items = rows.slice(0, q.data.limit).map(mapMessage); success(res, req, { items, nextCursor: more ? items.at(-1)?.id ?? null : null, totalEstimate: null }); });
  router.post("/chat/sessions/:id/escalate", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options); const id = parseId(req, res); const input = parseBody(EscalateSchema, req, res); if (!who || !id || !input) return; const s = await db.chatSession.findUnique({ where: { id } }); if (!s || !canSee(who, s.ownerId)) return failure(res, req, 404, "NOT_FOUND", "The chat session was not found."); const e = await db.escalation.create({ data: { sessionId: id, reason: input.reason } }); await db.chatSession.update({ where: { id }, data: { status: "human_held" } }); success(res, req, e, 201, true); });
  router.post("/chat/sessions/:id/takeover", async (req, res) => updateHold(db, options, req, res, "human_held")); router.post("/chat/sessions/:id/handback", async (req, res) => updateHold(db, options, req, res, "open"));
  router.get("/proposals", async (req, res) => {
    const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:read"); if (!who) return;
    const q = CursorQuerySchema.safeParse({ cursor: req.query.cursor, limit: req.query.limit });
    if (!q.success) return failure(res, req, 400, "VALIDATION_FAILED", "The pagination query is invalid.");
    const where: Prisma.ProposalWhereInput = isStaff(who) && who.organizationId
      ? { organizationId: who.organizationId }
      : { OR: [{ ownerId: who.userId }, { guestInvites: { some: { userId: who.userId, status: "active" } } }] };
    const rows = await db.proposal.findMany({
      where,
      include: { options: true, milestones: true },
      orderBy: { updatedAt: "desc" },
      take: q.data.limit + 1,
      ...(q.data.cursor ? { skip: 1, cursor: { id: q.data.cursor } } : {}),
    });
    const more = rows.length > q.data.limit;
    const items: Array<ReturnType<typeof mapProposal> & { links: { portal: string } }> = [];
    let lastSeenId: string | null = null;
    for (const row of rows.slice(0, q.data.limit)) {
      lastSeenId = row.id;
      try { items.push({ ...mapProposal(row), links: { portal: proposalPortalUrl(row.id) } }); }
      catch (error) {
        logEvent("warn", "proposal_list_skipped_invalid_row", {
          proposalId: row.id,
          kind: error instanceof Error ? error.name : typeof error,
        });
      }
    }
    success(res, req, { items, nextCursor: more ? lastSeenId : null, totalEstimate: null });
  });
  router.post("/proposals", async (req, res) => {
    const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:write");
    const input = parseBody(ProposalInputSchema, req, res);
    if (!who || !input) return;
    const catalog = await loadActiveCatalog(db);
    try { parseCatalogPricing(catalog, input.engagement, input.pricing); }
    catch (error) { if (error instanceof BillingScheduleError) return failure(res, req, 400, "VALIDATION_FAILED", error.message); throw error; }
    const planned = await planTimelineWrite(db, null, {}, [], { startDate: input.timeline.startDate ?? null, targetDate: input.timeline.targetDate ?? null, milestones: input.timeline.milestones ?? [] });
    const resolved = { milestones: planned.rows ?? [], warnings: planned.warnings };
    const timeline = { startDate: planned.timeline.startDate, targetDate: planned.timeline.targetDate, milestones: resolved.milestones };
    const created = await db.$transaction(async (tx) => {
      const row = await tx.proposal.create({
        data: {
          ownerId: who.userId,
          organizationId: who.organizationId ?? null,
          title: input.title,
          engagement: input.engagement,
          scope: inputJson(input.scope),
          timeline: inputJson(timeline),
          pricingModel: input.pricing.model as Prisma.ProposalCreateInput["pricingModel"],
          pricing: inputJson(input.pricing),
          catalogVersionId: catalog.id,
        },
      });
      if (resolved.milestones.length) {
        await tx.timelineMilestone.createMany({ data: resolved.milestones.map((milestone) => ({ proposalId: row.id, ...milestoneTableRow(milestone) })) });
      }
      return row;
    });
    const p = await db.proposal.findUnique({ where: { id: created.id }, include: { options: true, milestones: true } });
    if (!p) return failure(res, req, 500, "INTERNAL_ERROR", "The created proposal could not be loaded.");
    success(res, req, mapProposal(p), 201, true, { warnings: resolved.warnings });
  });
  router.get("/proposals/:id", proposalRead(db, options, false)); router.get("/proposals/:id/status", proposalRead(db, options, true));
  router.post("/proposals/:id/views", async (req, res) => {
    const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:read");
    const id = parseId(req, res);
    const input = parseBody(z.object({ sectionKey: z.string().trim().min(1).max(80) }).strict(), req, res);
    if (!who || !id || !input) return;
    const p = await db.proposal.findUnique({ where: { id }, select: { id: true, ownerId: true, organizationId: true } });
    if (!p || !(await canSeeProposal(db, who, p))) return failure(res, req, 404, "NOT_FOUND", "The proposal was not found.");
    await db.proposalView.create({ data: { id: randomUUID(), proposalId: id, viewerId: who.userId, sectionKey: input.sectionKey } });
    success(res, req, { recorded: true }, 201, true);
  });
  router.get("/proposals/:id/views", async (req, res) => {
    const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:read");
    const id = parseId(req, res);
    if (!who || !id) return;
    const p = await db.proposal.findUnique({ where: { id }, select: { id: true, ownerId: true, organizationId: true } });
    if (!p || !(await canSeeProposal(db, who, p))) return failure(res, req, 404, "NOT_FOUND", "The proposal was not found.");
    const rows = await db.proposalView.findMany({ where: { proposalId: id }, select: { sectionKey: true, viewerId: true } });
    success(res, req, summarizeViews(rows));
  });
  router.get("/proposals/:id/sections", async (req, res) => {
    const p = await loadProposal(db, options, req, res);
    if (!p) return;
    await prismaCompletionStore(db).ensure(p.id);
    await markWrittenParts(db, p.id);
    const nodes = await db.proposalNode.findMany({ where: { proposalId: p.id }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }], select: { key: true, title: true, clientLabel: true, kind: true, stateCode: true, sortOrder: true, parentKey: true } });
    success(res, req, { proposalId: p.id, sections: sectionListView(nodes) });
  });
  router.patch("/proposals/:id", async (req, res) => {
    const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:write");
    const id = parseId(req, res);
    const input = parseBody(ProposalPatchSchema, req, res);
    if (!who || !id || !input) return;
    const old = await db.proposal.findUnique({ where: { id }, include: { milestones: true } });
    if (!old || !canSee(who, old.ownerId, old.organizationId)) return failure(res, req, 404, "NOT_FOUND", "The proposal was not found.");
    const planned = input.timeline === undefined ? undefined : await planTimelineWrite(db, id, asObject(old.timeline), old.milestones, input.timeline);
    const timeline = planned?.timeline;
    const resolved = planned?.rows ? { milestones: planned.rows, warnings: planned.warnings } : null;
    // Only fields whose stored value would change count. Re-sending what is stored is a no-op: no new version, no review reopen.
    const changedFields = changedProposalFields(
      { title: old.title, engagement: old.engagement, scope: old.scope, pricing: old.pricing, timeline: old.timeline, status: old.status },
      { title: input.title, engagement: input.engagement, scope: input.scope, pricing: input.pricing, timeline, status: input.status },
    );
    if (!changedFields.length) {
      const same = await db.proposal.findUnique({ where: { id }, include: { options: true, milestones: true } });
      if (!same) return failure(res, req, 500, "INTERNAL_ERROR", "The proposal could not be loaded.");
      return success(res, req, mapProposal(same), 200, false, { warnings: planned?.warnings ?? [] });
    }
    const commercial = changedFields.some((field) => field === "scope" || field === "pricing" || field === "engagement");
    const contentFields = changedFields.filter((field) => field !== "status");
    if (contentFields.length) {
      try { await guardProposalEdit(db, id, who, { parts: partsForFields(contentFields), clientEditableCheck: commercial }); }
      catch (error) { if (error instanceof ReviewError) return failure(res, req, error.status, error.code, error.message, error.details ? [error.details] : undefined); throw error; }
    }
    let pendingPrice: { model: string; pricing: JsonRecord } | undefined;
    if (input.pricing !== undefined) {
      const catalog = await loadActiveCatalog(db);
      try { parseCatalogPricing(catalog, input.engagement ?? old.engagement, input.pricing); }
      catch (error) {
        if (error instanceof BillingScheduleError) { failure(res, req, 400, "VALIDATION_FAILED", error.message); return; }
        throw error;
      }
    } else if (input.engagement !== undefined && input.engagement !== old.engagement) {
      const target = await db.engagementPricingModel.findUnique({ where: { engagement: input.engagement } });
      if (!target) { failure(res, req, 400, "VALIDATION_FAILED", "That engagement is not offered."); return; }
      const priced = duplicatePricing(old, input.engagement, target);
      pendingPrice = { model: target.pricingModel, pricing: priced.pricing as JsonRecord };
    }
    const data: Prisma.ProposalUpdateInput = { version: { increment: 1 } };
    if (input.title !== undefined) data.title = input.title;
    if (input.engagement !== undefined) data.engagement = input.engagement;
    if (input.scope !== undefined) data.scope = inputJson(input.scope);
    if (timeline !== undefined) data.timeline = inputJson(timeline);
    if (input.pricing !== undefined) {
      data.pricingModel = input.pricing.model as Prisma.ProposalCreateInput["pricingModel"];
      data.pricing = inputJson(input.pricing);
    } else if (pendingPrice) {
      data.pricingModel = pendingPrice.model as Prisma.ProposalCreateInput["pricingModel"];
      data.pricing = inputJson(pendingPrice.pricing);
    }
    if (input.status !== undefined) data.status = input.status;
    if (resolved) {
      await db.$transaction(async (tx) => {
        await tx.timelineMilestone.deleteMany({ where: { proposalId: id } });
        if (resolved.milestones.length) {
          await tx.timelineMilestone.createMany({ data: resolved.milestones.map((milestone) => ({ proposalId: id, ...milestoneTableRow(milestone) })) });
        }
        await tx.proposal.update({ where: { id }, data });
      });
    } else {
      await db.proposal.update({ where: { id }, data });
    }
    if (commercial) {
      try { await recordCommercialEdit(db, id, who); }
      catch (error) { if (error instanceof ReviewError) return failure(res, req, error.status, error.code, error.message); throw error; }
    }
    const written = writtenKeysForPatch({ scope: input.scope, timeline, pricing: input.pricing });
    if (written.length) await markWrittenParts(db, id, written);
    const p = await db.proposal.findUnique({ where: { id }, include: { options: true, milestones: true } });
    if (!p) return failure(res, req, 500, "INTERNAL_ERROR", "The updated proposal could not be loaded.");
    success(res, req, mapProposal(p), 200, true, { warnings: planned?.warnings ?? [] });
  });
  router.delete("/proposals/:id", async (req, res) => { const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:write"); const id = parseId(req, res); if (!who || !id) return; const old = await db.proposal.findUnique({ where: { id } }); if (!old || !canSee(who, old.ownerId, old.organizationId)) return failure(res, req, 404, "NOT_FOUND", "The proposal was not found."); await db.proposal.delete({ where: { id } }); success(res, req, { id }, 200, true); });
  return router;
}

function proposalRead(db: PrismaClient, options: ChatProposalReadOptions, statusOnly: boolean) { return async (req: Request, res: Response) => { const p = await loadProposal(db, options, req, res); if (!p) return; if (statusOnly) return success(res, req, await statusEntity(db, p)); const viewerId = (req as AuthenticatedRequest).session?.userId; if (typeof viewerId === "string") await db.proposalView.create({ data: { id: randomUUID(), proposalId: p.id, viewerId, sectionKey: null } }).catch(() => undefined); success(res, req, { ...mapProposal(p), build: process.env.UNWH_VERSION ?? "unknown" }); }; }
async function statusEntity(db: PrismaClient, p: { id: string; status: string; version: number; updatedAt: Date; reviewState: string; approvedVersionId: string | null }) {
  const [state, latest, openStatuses, commentTypes] = await Promise.all([
    db.proposalReviewStatus.findUnique({ where: { code: p.reviewState } }),
    db.proposalVersion.findFirst({ where: { proposalId: p.id }, orderBy: { number: "desc" } }),
    db.proposalReviewCommentStatus.findMany({ where: { open: true } }),
    db.proposalReviewCommentType.findMany({ where: { blocksApproval: true } }),
  ]);
  const open = openStatuses.map((item) => item.code);
  const [openComments, blockingComments, openFlags, blockingFlags] = await Promise.all([
    db.proposalReviewComment.count({ where: { proposalId: p.id, status: { in: open } } }),
    db.proposalReviewComment.count({ where: { proposalId: p.id, status: { in: open }, typeCode: { in: commentTypes.map((item) => item.code) } } }),
    db.proposalReviewFlag.count({ where: { proposalId: p.id, status: { in: open } } }),
    db.proposalReviewFlag.count({ where: { proposalId: p.id, status: { in: open }, blocksApproval: true } }),
  ]);
  return {
    id: p.id, status: p.status, version: p.version, updatedAt: p.updatedAt.toISOString(),
    review: {
      state: p.reviewState, clientLabel: state?.clientLabel ?? p.reviewState, staffLabel: state?.staffLabel ?? p.reviewState, terminal: state?.terminal ?? false,
      versionNumber: latest?.number ?? null, locked: !!p.approvedVersionId && !!latest?.locked, approvedVersionId: p.approvedVersionId,
      openComments, openBlockingComments: blockingComments, openFlags, openBlockingFlags: blockingFlags,
    },
  };
}
async function loadProposal(db: PrismaClient, options: ChatProposalReadOptions, req: Request, res: Response) { const who = await auth(req as AuthenticatedRequest, res, options, undefined, "proposals:read"); const id = parseId(req, res); if (!who || !id) return undefined; const p = await db.proposal.findUnique({ where: { id }, include: { options: true, milestones: true } }); if (!p || !(await canSeeProposal(db, who, p))) { failure(res, req, 404, "NOT_FOUND", "The proposal was not found."); return undefined; } return p; }
async function updateHold(db: PrismaClient, options: ChatProposalReadOptions, req: Request, res: Response, status: "open" | "human_held") { const who = await auth(req as AuthenticatedRequest, res, options, "staff", "chat:write"); const id = parseId(req, res); if (!who || !id) return; const s = await db.chatSession.findUnique({ where: { id } }); if (!s) return failure(res, req, 404, "NOT_FOUND", "The chat session was not found."); const updated = await db.chatSession.update({ where: { id }, data: { status } }); success(res, req, mapSession(updated), 200, true); }

export default createChatProposalReadRouter;

/**
 * Sections in display order: key, title, and order so clients can see which sections exist; id stays equal to key for older callers.
 * sortOrder is only meaningful among siblings, so the list is walked as a tree: each parent is followed by its own sub-parts.
 * A sub-part whose parent is missing is listed at the top level instead of being dropped.
 */
export function sectionListView(nodes: readonly { key: string; title: string; clientLabel: string; kind: string; stateCode: string; sortOrder: number; parentKey: string | null }[]) {
  type Node = (typeof nodes)[number];
  const keys = new Set(nodes.map((node) => node.key));
  const bySibling = (a: Node, b: Node) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key);
  const children = new Map<string | null, Node[]>();
  for (const node of nodes) {
    const parent = node.parentKey && keys.has(node.parentKey) && node.parentKey !== node.key ? node.parentKey : null;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const ordered: Node[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const node of [...(children.get(parent) ?? [])].sort(bySibling)) {
      if (seen.has(node.key)) continue;
      seen.add(node.key);
      ordered.push(node);
      walk(node.key);
    }
  };
  walk(null);
  // Parent cycles never reach the root; list them last rather than dropping them.
  for (const node of [...nodes].sort(bySibling)) if (!seen.has(node.key)) { seen.add(node.key); ordered.push(node); }
  return ordered.map((node, index) => ({ id: node.key, key: node.key, title: node.title, clientLabel: node.clientLabel, kind: node.kind, order: index + 1, sortOrder: node.sortOrder, parentKey: node.parentKey, status: node.stateCode }));
}
