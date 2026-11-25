import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { CompletionError } from "../completionTree.js";
import { prismaProgressStore, proposalProgress, recommendHandoff, resolvePart, setPartState, type ProgressStore } from "../proposalProgress.js";
import { loadReview } from "../proposalReviewAgent.js";
import { rankCases } from "../guidanceCases.js";
import { guidanceSessionId, listGuidanceEvents, noteGuidanceAction, safeGuidanceTurn } from "../guidanceTurn.js";
import { applyChange, lockNode, parkChange, previewChange, prismaCompletionStore, retargetTemplate, treeView, unlockNode, type CompletionStore } from "../proposalCompletion.js";
import { stopTickler } from "../reminderDelivery.js";
import { ReviewError, editRefusal, type ReviewActorRole } from "../proposalReview.js";
import { prismaReviewStore } from "../proposalReviewStore.js";

type Principal = { userId: string; organizationId?: string; membershipRole?: string; isAdmin: boolean; scopes: string[] | null };

export type ProposalCompletionOptions = {
  prisma: PrismaClient;
  store?: CompletionStore;
  progressStore?: ProgressStore;
  authorize?: (request: Request) => Promise<Principal | undefined>;
  canSee?: (principal: Principal, proposalId: string) => Promise<boolean>;
};

const ChangeBody = z.object({ nodeKey: z.string().min(1), change: z.string().min(1).max(500) }).strict();
const ParkBody = ChangeBody.extend({ mode: z.string().min(1), swapSummary: z.string().min(1).max(500).optional() }).strict();
const LockBody = z.object({ versionId: z.string().uuid() }).strict();
const EdgeBody = z.object({ fromKey: z.string().min(1), toKey: z.string().min(1) }).strict();
const ResolveBody = z.object({ resolution: z.string().min(1), note: z.string().trim().max(1000).optional(), actor: z.enum(["client", "agent"]).optional() }).strict();
const StateBody = z.object({ state: z.string().min(1), note: z.string().trim().max(1000).optional(), actor: z.enum(["client", "agent"]).optional() }).strict();
const HandoffBody = z.object({ reasonCode: z.string().min(1), note: z.string().trim().max(1000).optional() }).strict();
const ParkItemBody = z.object({ summary: z.string().trim().min(1).max(2000) }).strict();
const TemplateBody = z.object({ code: z.string().min(1).max(64) }).strict();
const SectionAddBody = z.object({ nodeKey: z.string().min(1).max(64) }).strict();
const SectionOrderBody = z.object({ keys: z.array(z.string().min(1).max(64)).min(1).max(100), parentKey: z.string().min(1).max(64).nullable().optional() }).strict();
const SectionBody = z.object({ text: z.string().trim().min(1) }).strict();
const CustomSectionBody = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  title: z.string().trim().min(1).max(120),
  guidance: z.string().trim().min(1).max(2000),
  maxChars: z.number().int().min(100).max(20000),
}).strict();

function nodeRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

function sectionSpec(node: { body: unknown }, tableSpec: { guidance: string; maxChars: number; writtenState: string } | null) {
  if (tableSpec) return tableSpec;
  const body = nodeRecord(node.body);
  if (typeof body.guidance === "string" && typeof body.maxChars === "number") {
    return { guidance: body.guidance, maxChars: body.maxChars, writtenState: "drafted" };
  }
  return null;
}

const sectionView = (node: { key: string; title: string; clientLabel: string; stateCode: string; body: unknown; updatedAt?: Date }, spec: { guidance: string; maxChars: number }) => {
  const body = node.body && typeof node.body === "object" && !Array.isArray(node.body) ? node.body as Record<string, unknown> : {};
  return { key: node.key, title: node.title, clientLabel: node.clientLabel, state: node.stateCode, text: typeof body.text === "string" ? body.text : null, guidance: spec.guidance, maxChars: spec.maxChars, updatedAt: node.updatedAt?.toISOString() ?? null };
};

// Narrative text should not carry hours or prices: those live in the hours and price parts and are set by staff or the catalog.
const PRICE_IN_TEXT = /(?:[$€£]\s?\d)|(?:\b\d[\d,]*(?:\.\d+)?\s?(?:usd|dollars|k\b))|(?:\busd\s?\d)/i;
const HOURS_IN_TEXT = /\b\d+(?:\.\d+)?\s?(?:hours?|hrs?)\b/i;
/** Terms carries the agreed fee by design, so it is not checked. */
export function narrativeCommercialWarnings(nodeKey: string, text: string): Warning[] {
  if (nodeKey === "terms") return [];
  const warnings: Warning[] = [];
  const price = text.match(PRICE_IN_TEXT);
  if (price) warnings.push({ code: "NARRATIVE_HAS_PRICE", message: `The ${nodeKey} text mentions a price ("${price[0].trim()}"). Keep prices in the price part; narrative sections should not state them.`, path: nodeKey });
  const hours = text.match(HOURS_IN_TEXT);
  if (hours) warnings.push({ code: "NARRATIVE_HAS_HOURS", message: `The ${nodeKey} text mentions hours ("${hours[0].trim()}"). Keep hours in the hours part; narrative sections should not state them.`, path: nodeKey });
  return warnings;
}

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const param = (request: Request, name: string) => {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};
type Warning = { code: string; message: string; path?: string };
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200, warnings: Warning[] = []) =>
  response.status(status).json({ ok: true, changed, entity, warnings, links: {}, requestId: requestId(request) });
const fail = (request: Request, response: Response, status: number, code: string, message: string, details?: Record<string, unknown>) =>
  response.status(status).json({ ok: false, code, message, ...(details ? { details } : {}), retryable: status >= 500, requestId: requestId(request) });

/** Review role for a content write: the agent header wins, then staff membership, else client. */
const editRole = (request: Request, principal: Principal): ReviewActorRole => {
  if (request.header("x-unw-review-actor") === "agent") return "agent";
  return principal.isAdmin || principal.membershipRole === "staff" ? "staff" : "client";
};

const defaultAuthorize = (prisma: PrismaClient) => async (request: Request): Promise<Principal | undefined> => {
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

export function createProposalCompletionRouter({ prisma, store = prismaCompletionStore(prisma), progressStore = prismaProgressStore(prisma), authorize = defaultAuthorize(prisma), canSee }: ProposalCompletionOptions): Router {
  const router = Router();
  const visible = canSee ?? (async (principal: Principal, proposalId: string) => {
    const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
    if (!proposal) return false;
    if (principal.isAdmin || principal.membershipRole === "staff") return true;
    return proposal.ownerId === principal.userId || Boolean(principal.organizationId && proposal.organizationId === principal.organizationId);
  });

  const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
    try { await handler(request, response); }
    catch (error) {
      if (error instanceof CompletionError) { fail(request, response, error.status, error.code, error.message); return; }
      if (error instanceof ReviewError) { fail(request, response, error.status, error.code, error.message, error.details); return; }
      if (error instanceof z.ZodError) { fail(request, response, 400, "VALIDATION_FAILED", `The request body is invalid: ${error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ")}.`, { issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }); return; }
      console.error(error);
      fail(request, response, 500, "INTERNAL_ERROR", "The request could not be completed.");
    }
  };

  const auth = async (request: Request, response: Response, scope: string, proposalId: string) => {
    const principal = await authorize(request);
    if (!principal) { fail(request, response, 401, "AUTH_REQUIRED", "Authentication is required."); return undefined; }
    if (principal.scopes && !scopeAllows(principal.scopes, scope)) { fail(request, response, 403, "SCOPE_REQUIRED", `The ${scope} scope is required.`); return undefined; }
    if (!(await visible(principal, proposalId))) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return undefined; }
    return principal;
  };

  // Adding or removing parts changes the proposal the same way a content edit does, so it follows the same review rule.
  const refuseStructureEdit = async (request: Request, principal: Principal, proposalId: string, part: string) => {
    const row = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { reviewState: true } });
    if (!row || !("proposalReviewStatus" in prisma)) return;
    const refusal = editRefusal(await prismaReviewStore(prisma).policy(), row.reviewState, editRole(request, principal), { part });
    if (refusal) throw refusal;
  };

  router.get("/proposals/:id/completion", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    ok(request, response, await treeView(store, id));
  }));

  router.get("/proposals/:id/progress", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const view = await proposalProgress(store, progressStore, id, principal.userId, { markSeen: request.query.markSeen === "true" });
    const agentCaller = principal.scopes !== null || Boolean(request.header("x-unw-guidance-session"));
    const guidance = agentCaller ? await safeGuidanceTurn(prisma, {
      proposalId: id,
      sessionId: guidanceSessionId(request, principal.userId, id),
      // A plain progress read is not a conversation turn: it previews fresh guidance without writing an event or bumping
      // turnIndex. A session's first read records the baseline turn; recordTurn=true records a turn explicitly.
      record: request.query.recordTurn === "true" ? "always" : request.query.markSeen === "true" ? "if-absent" : "preview",
    }) : null;
    ok(request, response, guidance ? { ...view, guidance } : view);
  }));

  router.post("/proposals/:id/progress/seen", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const view = await proposalProgress(store, progressStore, id, principal.userId, { markSeen: true });
    ok(request, response, { percent: view.percent, settled: view.settled, total: view.total }, true);
  }));

  router.post("/proposals/:id/completion/nodes/:nodeKey/resolve", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = ResolveBody.parse(request.body ?? {});
    const actor = body.actor ?? (principal.scopes ? "agent" : "client");
    const resolved = await resolvePart(store, progressStore, id, { nodeKey: param(request, "nodeKey"), resolution: body.resolution, note: body.note, actorId: principal.userId, actor });
    const unsure = body.resolution === "unsure";
    await noteGuidanceAction(prisma, { proposalId: id, sessionId: guidanceSessionId(request, principal.userId, id), actionTaken: unsure ? "mark_unsure" : "resolved", chosenMove: unsure ? "mark_unsure" : null });
    ok(request, response, resolved, true);
  }));

  router.post("/proposals/:id/completion/nodes/:nodeKey/state", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = StateBody.parse(request.body ?? {});
    const actor = body.actor ?? (principal.scopes ? "agent" : "client");
    const updated = await setPartState(store, progressStore, id, { nodeKey: param(request, "nodeKey"), state: body.state, note: body.note, actorId: principal.userId, actor });
    await noteGuidanceAction(prisma, { proposalId: id, sessionId: guidanceSessionId(request, principal.userId, id), actionTaken: "resolved", chosenMove: null });
    ok(request, response, updated, true);
  }));

  router.post("/proposals/:id/handoff", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = HandoffBody.parse(request.body ?? {});
    const handoff = await recommendHandoff(progressStore, id, { reasonCode: body.reasonCode, note: body.note, actorId: principal.userId });
    await stopTickler(prisma, id, "handoff");
    await noteGuidanceAction(prisma, { proposalId: id, sessionId: guidanceSessionId(request, principal.userId, id), actionTaken: "handoff", chosenMove: "recommend_handoff" });
    ok(request, response, handoff, true);
  }));

  router.get("/proposals/:id/review-feedback", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    await store.ensure(id);
    ok(request, response, await loadReview(prisma, id));
  }));

  router.get("/proposals/:id/narrative", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    await store.ensure(id);
    const [specs, nodes] = await Promise.all([
      prisma.proposalSectionSpec.findMany(),
      prisma.proposalNode.findMany({ where: { proposalId: id }, orderBy: { sortOrder: "asc" } }),
    ]);
    const byKey = new Map(specs.map((spec) => [spec.nodeKey, spec]));
    ok(request, response, nodes.filter((node) => byKey.has(node.key)).map((node) => sectionView(node, byKey.get(node.key)!)));
  }));

  router.get("/proposals/:id/freshness", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const proposal = await prisma.proposal.findUnique({ where: { id }, select: { version: true, updatedAt: true } });
    if (!proposal) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const parts = await prisma.proposalNode.findMany({ where: { proposalId: id }, select: { key: true, updatedAt: true }, orderBy: { sortOrder: "asc" } });
    ok(request, response, {
      record: { version: proposal.version, updatedAt: proposal.updatedAt.toISOString() },
      parts: parts.map((part) => ({ key: part.key, updatedAt: part.updatedAt.toISOString() })),
    });
  }));

  router.get("/proposals/:id/narrative/:nodeKey", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const nodeKey = param(request, "nodeKey");
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: id, key: nodeKey } });
    if (!node) { fail(request, response, 404, "NOT_FOUND", `The proposal has no ${nodeKey} part.`); return; }
    const spec = sectionSpec(node, await prisma.proposalSectionSpec.findUnique({ where: { nodeKey } }));
    if (!spec) { fail(request, response, 404, "NOT_FOUND", `No proposal section is configured for ${nodeKey}.`); return; }
    ok(request, response, sectionView(node, spec));
  }));

  router.put("/proposals/:id/narrative/:nodeKey", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const nodeKey = param(request, "nodeKey");
    const body = SectionBody.parse(request.body ?? {});
    await store.ensure(id);
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: id, key: nodeKey } });
    if (!node) { fail(request, response, 404, "NOT_FOUND", `The proposal has no ${nodeKey} part.`); return; }
    const spec = sectionSpec(node, await prisma.proposalSectionSpec.findUnique({ where: { nodeKey } }));
    if (!spec) { fail(request, response, 404, "NOT_FOUND", `No proposal section is configured for ${nodeKey}.`); return; }
    if (body.text.length > spec.maxChars) { fail(request, response, 400, "VALIDATION_FAILED", `The ${nodeKey} section is limited to ${spec.maxChars} characters.`); return; }
    // Writing the text already stored is a no-op, so retries do not trip review locks.
    const stored = node.body && typeof node.body === "object" && !Array.isArray(node.body) ? (node.body as { text?: unknown }).text : undefined;
    if (stored === body.text && node.stateCode === spec.writtenState) { ok(request, response, sectionView(node, spec), false); return; }
    // Same rule as structured fields: approved or closed proposals refuse edits, a part locked on a version refuses every role,
    // and while the proposal is with Unwhelm only staff and the agent may edit.
    const proposalRow = await prisma.proposal.findUnique({ where: { id }, select: { reviewState: true } });
    if (proposalRow) {
      const refusal = editRefusal(await prismaReviewStore(prisma).policy(), proposalRow.reviewState, editRole(request, principal), { part: nodeKey, lockedParts: [{ key: nodeKey, lockedVersionId: node.lockedVersionId }] });
      if (refusal) throw refusal;
    } else if (node.lockedVersionId) {
      fail(request, response, 409, "SECTION_LOCKED", `The ${nodeKey} part is locked on a proposal version. Unlock it with unw_unlock_node before editing.`, { lockedParts: [{ key: nodeKey, lockedVersionId: node.lockedVersionId }] });
      return;
    }
    const updated = await prisma.proposalNode.update({
      where: { id: node.id },
      data: { body: { ...nodeRecord(node.body), text: body.text, updatedBy: principal.userId, updatedAt: new Date().toISOString() }, stateCode: spec.writtenState },
    });
    ok(request, response, sectionView(updated, spec), true, 200, narrativeCommercialWarnings(nodeKey, body.text));
  }));

  router.post("/proposals/:id/completion/preview", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const body = ChangeBody.parse(request.body ?? {});
    ok(request, response, await previewChange(store, id, body.nodeKey, body.change));
  }));

  router.post("/proposals/:id/completion/apply", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = ChangeBody.parse(request.body ?? {});
    ok(request, response, await applyChange(store, id, body.nodeKey, body.change, principal.userId), true);
  }));

  router.post("/proposals/:id/completion/park", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = ParkBody.parse(request.body ?? {});
    const parked = await parkChange(store, id, { nodeKey: body.nodeKey, change: body.change, mode: body.mode, swapSummary: body.swapSummary, actorId: principal.userId });
    await noteGuidanceAction(prisma, { proposalId: id, sessionId: guidanceSessionId(request, principal.userId, id), actionTaken: "parked", chosenMove: body.mode === "swap" ? "offer_swap" : "offer_park" });
    ok(request, response, parked, true);
  }));

  router.post("/proposals/:id/completion/nodes/:nodeKey/lock", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = LockBody.parse(request.body ?? {});
    ok(request, response, await lockNode(store, id, param(request, "nodeKey"), body.versionId, principal.userId), true);
  }));

  router.post("/proposals/:id/completion/nodes/:nodeKey/unlock", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const unlocked = await unlockNode(store, id, param(request, "nodeKey"), principal.userId);
    ok(request, response, unlocked, unlocked.applied);
  }));

  router.post("/proposals/:id/completion/edges", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    if (principal.membershipRole !== "staff" && !principal.isAdmin) { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    const body = EdgeBody.parse(request.body ?? {});
    await store.ensure(id);
    ok(request, response, await store.addEdge(id, body.fromKey, body.toKey), true, 201);
  }));

  router.get("/proposals/:id/parked-items", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    // Both kinds of parked work: intake items (unw_park_item) and parked changes (unw_park_change, phase_2 or swap).
    const [items, changes] = await Promise.all([store.listParkedItems(id), store.parked(id)]);
    ok(request, response, {
      items: [
        ...items.map((item) => ({ ...item, kind: "item" as const })),
        ...changes.map((change) => ({ ...change, kind: "change" as const })),
      ],
    });
  }));

  router.post("/proposals/:id/parked-items", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = ParkItemBody.parse(request.body ?? {});
    const parked = await store.parkItem(id, body.summary, principal.userId);
    await noteGuidanceAction(prisma, { proposalId: id, sessionId: guidanceSessionId(request, principal.userId, id), actionTaken: "parked", chosenMove: "offer_park" });
    ok(request, response, parked, true, 201);
  }));

  router.delete("/proposals/:id/completion/edges/:edgeId", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    if (principal.membershipRole !== "staff" && !principal.isAdmin) { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    await store.removeEdge(id, param(request, "edgeId"));
    ok(request, response, { removed: true }, true);
  }));

  type TemplateRow = {
    code: string; name: string; description: string; suggestedPricingModel: string | null;
    nodes: Array<{ nodeKey: string; sortOrder: number; parentKey: string | null; node: { kind: string; title: string } }>;
    samples: Array<{ nodeKey: string; content: unknown }>;
    options: Array<{ code: string; label: string; description: string; selection: string }>;
  };
  // Samples are starting content for each part (narrative text, scope, relative milestones); options carry no price.
  const templateView = (row: TemplateRow) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    suggestedPricingModel: row.suggestedPricingModel,
    nodes: row.nodes.map((item) => ({ key: item.nodeKey, kind: item.node.kind, title: item.node.title, parentKey: item.parentKey, sortOrder: item.sortOrder })),
    samples: Object.fromEntries(row.samples.map((sample) => [sample.nodeKey, sample.content])),
    options: row.options.map((option) => ({ code: option.code, label: option.label, description: option.description, selection: option.selection })),
  });
  const templateInclude = {
    nodes: { include: { node: true }, orderBy: { sortOrder: "asc" as const } },
    samples: true,
    options: { orderBy: { sortOrder: "asc" as const } },
  };

  router.get("/proposal-templates", run(async (request, response) => {
    const principal = await authorize(request);
    if (!principal) { fail(request, response, 401, "AUTH_REQUIRED", "Authentication is required."); return; }
    if (principal.scopes && !scopeAllows(principal.scopes, "proposals:read")) { fail(request, response, 403, "SCOPE_REQUIRED", "The proposals:read scope is required."); return; }
    const rows = await prisma.proposalTemplate.findMany({ where: { active: true }, include: templateInclude, orderBy: { sortOrder: "asc" } });
    ok(request, response, rows.map(templateView));
  }));

  router.put("/proposals/:id/template", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = TemplateBody.parse(request.body ?? {});
    const template = await prisma.proposalTemplate.findFirst({ where: { code: body.code, active: true }, include: templateInclude });
    if (!template) throw new CompletionError(404, "NOT_FOUND", "That proposal template does not exist.");
    // A draft can move to another template. Parts shared by both keep their written text. Locked drafts cannot.
    if (await prisma.proposalNode.count({ where: { proposalId: id } }) > 0) {
      const current = await prisma.proposal.findUniqueOrThrow({ where: { id }, select: { templateCode: true } });
      if (current.templateCode === template.code) { ok(request, response, templateView(template)); return; }
      const { keptWritten } = await retargetTemplate(prisma, id, template.code);
      ok(request, response, { ...templateView(template), keptWritten }, true, 200, keptWritten.length
        ? [{ code: "WRITTEN_PARTS_KEPT", message: `These parts are not in the ${template.code} template but hold written text, so they were kept as extra parts: ${keptWritten.join(", ")}. Remove them with unw_remove_proposal_section if they are not needed.` }]
        : []);
      return;
    }
    await prisma.proposal.update({ where: { id }, data: { templateCode: template.code } });
    await store.ensure(id);
    ok(request, response, templateView(template), true);
  }));

  const libraryView = (row: { nodeKey: string; category: string; description: string; node: { title: string; clientLabel: string } }, spec?: { guidance: string; maxChars: number }) => ({
    key: row.nodeKey,
    title: row.node.title,
    clientLabel: row.node.clientLabel,
    category: row.category,
    description: row.description,
    guidance: spec?.guidance ?? null,
    maxChars: spec?.maxChars ?? null,
  });

  router.get("/proposal-section-library", run(async (request, response) => {
    const principal = await authorize(request);
    if (!principal) { fail(request, response, 401, "AUTH_REQUIRED", "Authentication is required."); return; }
    if (principal.scopes && !scopeAllows(principal.scopes, "proposals:read")) { fail(request, response, 403, "SCOPE_REQUIRED", "The proposals:read scope is required."); return; }
    const [rows, specs] = await Promise.all([
      prisma.proposalSectionLibrary.findMany({ where: { active: true }, include: { node: true }, orderBy: { sortOrder: "asc" } }),
      prisma.proposalSectionSpec.findMany(),
    ]);
    ok(request, response, rows.map((row) => libraryView(row, specs.find((spec) => spec.nodeKey === row.nodeKey))));
  }));

  // Approach B: approved cases that resemble this proposal's latest guidance signals, as examples for the agent.
  router.get("/proposals/:id/guidance-cases", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const move = typeof request.query.move === "string" && request.query.move ? request.query.move : undefined;
    const limit = Math.min(Math.max(Number(request.query.limit ?? 5) || 5, 1), 20);
    const visibleStatuses = (await prisma.guidanceCaseStatus.findMany({ where: { agentVisible: true } })).map((row) => row.code);
    const [cases, latest] = await Promise.all([
      prisma.guidanceCase.findMany({ where: { statusCode: { in: visibleStatuses } } }),
      prisma.guidanceSessionEvent.findFirst({ where: { proposalId: id }, orderBy: { createdAt: "desc" } }),
    ]);
    ok(request, response, { basedOnSignals: latest?.signals ?? {}, cases: rankCases(cases, latest?.signals ?? {}, { move, limit }) });
  }));

  router.get("/proposals/:id/guidance-events", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:read", id);
    if (!principal) return;
    const limit = Math.min(Math.max(Number(request.query.limit ?? 20) || 20, 1), 50);
    ok(request, response, await listGuidanceEvents(prisma, id, limit));
  }));

  router.post("/proposals/:id/sections", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = SectionAddBody.parse(request.body ?? {});
    const entry = await prisma.proposalSectionLibrary.findFirst({ where: { nodeKey: body.nodeKey, active: true }, include: { node: true } });
    if (!entry) throw new CompletionError(404, "NOT_FOUND", "That section is not in the section library.");
    const spec = await prisma.proposalSectionSpec.findUnique({ where: { nodeKey: entry.nodeKey } });
    await store.ensure(id);
    if (!(await prisma.proposalNode.findFirst({ where: { proposalId: id, key: entry.nodeKey } }))) await refuseStructureEdit(request, principal, id, entry.nodeKey);
    // Adding a section the proposal already has is a no-op, so the agent can retry safely.
    if (await prisma.proposalNode.findFirst({ where: { proposalId: id, key: entry.nodeKey } })) { ok(request, response, libraryView(entry, spec ?? undefined)); return; }
    const open = await prisma.proposalNodeState.findFirst({ where: { reopensDownstream: false, isLock: false, isReopenTarget: false }, orderBy: { sortOrder: "asc" } });
    if (!open) throw new CompletionError(500, "INTERNAL_ERROR", "No starting node state is configured.");
    try {
      await prisma.proposalNode.create({ data: {
        proposalId: id, key: entry.nodeKey, kind: entry.node.kind, title: entry.node.title, clientLabel: entry.node.clientLabel,
        stateCode: open.code, sortOrder: entry.node.sortOrder, parentKey: null,
      } });
    } catch (error) {
      // (proposal_id, key) is unique, so a concurrent add lands here; treat it as the same no-op.
      if ((error as { code?: string }).code === "P2002") { ok(request, response, libraryView(entry, spec ?? undefined)); return; }
      throw error;
    }
    ok(request, response, libraryView(entry, spec ?? undefined), true, 201);
  }));

  router.post("/proposals/:id/custom-sections", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = CustomSectionBody.parse(request.body ?? {});
    if (await prisma.proposalSectionLibrary.findFirst({ where: { nodeKey: body.key, active: true } })) {
      throw new CompletionError(409, "CONFLICT", "That key is already in the section library. Add it with the library instead.");
    }
    await store.ensure(id);
    const existing = await prisma.proposalNode.findFirst({ where: { proposalId: id, key: body.key } });
    if (existing) { ok(request, response, { key: body.key, title: existing.title, guidance: nodeRecord(existing.body).guidance ?? body.guidance, maxChars: nodeRecord(existing.body).maxChars ?? body.maxChars }); return; }
    await refuseStructureEdit(request, principal, id, body.key);
    const open = await prisma.proposalNodeState.findFirst({ where: { reopensDownstream: false, isLock: false, isReopenTarget: false }, orderBy: { sortOrder: "asc" } });
    if (!open) throw new CompletionError(500, "INTERNAL_ERROR", "No starting node state is configured.");
    const last = await prisma.proposalNode.aggregate({ where: { proposalId: id, parentKey: null }, _max: { sortOrder: true } });
    const created = await prisma.proposalNode.create({ data: {
      proposalId: id, key: body.key, kind: "section", title: body.title, clientLabel: body.title,
      stateCode: open.code, sortOrder: (last._max.sortOrder ?? 0) + 10, parentKey: null,
      body: { text: "", guidance: body.guidance, maxChars: body.maxChars },
    } });
    ok(request, response, { key: created.key, title: created.title, guidance: body.guidance, maxChars: body.maxChars }, true, 201);
  }));


  // Removing a section the proposal no longer has is a no-op, so retries are safe. Locked parts and parts with children stay.
  router.delete("/proposals/:id/sections/:nodeKey", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const nodeKey = param(request, "nodeKey");
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: id, key: nodeKey } });
    if (!node) { ok(request, response, { key: nodeKey, removed: false }); return; }
    const state = await prisma.proposalNodeState.findUnique({ where: { code: node.stateCode } });
    if (state?.isLock || node.lockedVersionId) throw new CompletionError(409, "SECTION_LOCKED", `The ${nodeKey} section is locked. Unlock it with unw_unlock_node before removing it.`);
    await refuseStructureEdit(request, principal, id, nodeKey);
    if (await prisma.proposalNode.count({ where: { proposalId: id, parentKey: nodeKey } })) throw new CompletionError(409, "CONFLICT", "That section has sub-parts. Remove them first.");
    await prisma.proposalNode.deleteMany({ where: { id: node.id } });
    ok(request, response, { key: nodeKey, removed: true }, true);
  }));

  // Moves the listed sibling sections to the front in the given order; the rest keep their relative order after them.
  router.put("/proposals/:id/section-order", run(async (request, response) => {
    const id = param(request, "id");
    const principal = await auth(request, response, "proposals:write", id);
    if (!principal) return;
    const body = SectionOrderBody.parse(request.body ?? {});
    if (new Set(body.keys).size !== body.keys.length) throw new CompletionError(400, "VALIDATION_FAILED", "Each section key may appear only once.");
    await store.ensure(id);
    const parentKey = body.parentKey ?? null;
    const siblings = await prisma.proposalNode.findMany({ where: { proposalId: id, parentKey }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });
    const unknown = body.keys.filter((key) => !siblings.some((node) => node.key === key));
    if (unknown.length) throw new CompletionError(400, "VALIDATION_FAILED", `These sections are not ${parentKey ? `under ${parentKey}` : "top-level parts"} of this proposal: ${unknown.join(", ")}.`);
    const ordered = [...body.keys.map((key) => siblings.find((node) => node.key === key)!), ...siblings.filter((node) => !body.keys.includes(node.key))];
    const changes = ordered.map((node, index) => ({ node, sortOrder: (index + 1) * 10 })).filter(({ node, sortOrder }) => node.sortOrder !== sortOrder);
    if (changes.length) await prisma.$transaction(changes.map(({ node, sortOrder }) => prisma.proposalNode.update({ where: { id: node.id }, data: { sortOrder } })));
    ok(request, response, { parentKey, sections: ordered.map((node, index) => ({ key: node.key, title: node.title, order: index + 1 })) }, changes.length > 0);
  }));

  return router;
}
