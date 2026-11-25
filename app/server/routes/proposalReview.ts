import { createHash, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { remainingApprovals } from "../approvalChain.js";
import {
  ReviewError,
  addComment,
  addFlag,
  applyTransition,
  diffVersions,
  noteCommercialEdit,
  resolveComment,
  reviseOwnComment,
  resolveFlag,
  transitionRefusal,
  editRefusal,
  sameContent,
  FIELD_PARTS,
  workspaceFor,
  type ReviewActorRole,
  type ReviewStore,
} from "../proposalReview.js";
import { prismaReviewStore } from "../proposalReviewStore.js";
import { guidanceSessionId, noteGuidanceAction } from "../guidanceTurn.js";
import { stopTickler } from "../reminderDelivery.js";

type Principal = {
  userId: string;
  organizationId?: string;
  membershipRole?: "prospect" | "client" | "staff";
  isAdmin: boolean;
  scopes: string[] | null;
};

export type ProposalReviewRouterOptions = {
  prisma: PrismaClient;
  store?: ReviewStore;
  authorize?: (request: Request) => Promise<Principal | undefined>;
};

const TargetKind = z.enum(["proposal", "section", "field", "scope", "milestone", "pricing_line", "option"]);

const TransitionBody = z.object({
  to: z.string().min(1),
  reasonCode: z.string().min(1).optional(),
  reasonText: z.string().optional(),
  commentBody: z.string().optional(),
  commentType: z.string().min(1).optional(),
  commentTargetKind: TargetKind.optional(),
  commentTargetId: z.string().min(1).optional(),
  meetingAt: z.string().datetime().optional(),
  meetingLink: z.string().optional(),
  meetingNotes: z.string().optional(),
  /** Optional guard: the transition taken must be one of these actions (for example handoff, not reopen, when moving to in_review). */
  actions: z.array(z.string().min(1)).min(1).optional(),
}).strict();

const CommentBody = z.object({
  body: z.string().min(1),
  type: z.string().min(1),
  visibility: z.string().min(1).default("client"),
  // Left out on replies, which keep their parent's target. Top-level comments default to the proposal.
  targetKind: TargetKind.optional(),
  targetId: z.string().min(1).optional(),
  parentId: z.string().uuid().optional(),
}).strict();

const FlagBody = z.object({
  kind: z.string().min(1).default("unbounded"),
  reason: z.string().min(1),
  visibility: z.string().min(1).default("client"),
  targetKind: TargetKind.default("proposal"),
  targetId: z.string().min(1).optional(),
}).strict();

const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const param = (request: Request, name: string) => {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};

const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200) =>
  response.status(status).json({ ok: true, changed, entity, warnings: [], links: {}, requestId: requestId(request) });

const fail = (request: Request, response: Response, status: number, code: string, message: string, details?: Record<string, unknown>) =>
  response.status(status).json({ ok: false, code, message, ...(details ? { details } : {}), retryable: status >= 500, requestId: requestId(request) });

/** Names the fields a body failed on, so callers can fix the request instead of guessing. */
const zodDetails = (error: z.ZodError) => ({ issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
const zodMessage = (error: z.ZodError) => `The request body is invalid: ${error.issues.map((issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`).join("; ")}.`;

const actorRole = (request: Request, principal: Principal): ReviewActorRole => {
  if (request.header("x-unw-review-actor") === "agent") return "agent";
  if (principal.isAdmin || principal.membershipRole === "staff") return "staff";
  return "client";
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
    return {
      userId: stored.userId,
      organizationId: stored.client.organizationId ?? membership?.organizationId ?? undefined,
      membershipRole: membership?.role,
      isAdmin: Boolean(stored.user.isAdmin),
      scopes,
    };
  }
  const userId = request.session?.userId;
  if (!userId) return undefined;
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { memberships: true } });
  if (!user) return undefined;
  const membership = request.session?.organizationId
    ? user.memberships.find((item) => item.organizationId === request.session?.organizationId && item.status === "active")
    : user.memberships.find((item) => item.status === "active");
  return {
    userId,
    organizationId: membership?.organizationId ?? request.session?.organizationId,
    membershipRole: membership?.role,
    isAdmin: Boolean(user.isAdmin),
    scopes: null,
  };
};

function canSee(principal: Principal, proposal: { ownerId: string; organizationId: string | null }, role: ReviewActorRole): boolean {
  if (role === "staff" || principal.isAdmin || principal.membershipRole === "staff") return true;
  return proposal.ownerId === principal.userId || Boolean(principal.organizationId && proposal.organizationId === principal.organizationId);
}

export function createProposalReviewRouter({ prisma, store = prismaReviewStore(prisma), authorize = defaultAuthorize(prisma) }: ProposalReviewRouterOptions): Router {
  const router = Router();

  const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
    try { await handler(request, response); }
    catch (error) {
      if (error instanceof ReviewError) { fail(request, response, error.status, error.code, error.message, error.details); return; }
      if (error instanceof z.ZodError) { fail(request, response, 400, "VALIDATION_FAILED", zodMessage(error), zodDetails(error)); return; }
      console.error(error);
      fail(request, response, 500, "INTERNAL_ERROR", "The request could not be completed.");
    }
  };

  const auth = async (request: Request, response: Response, scope: string) => {
    const principal = await authorize(request);
    if (!principal) { fail(request, response, 401, "AUTH_REQUIRED", "Authentication is required."); return undefined; }
    if (principal.scopes && !scopeAllows(principal.scopes, scope)) { fail(request, response, 403, "SCOPE_REQUIRED", `The ${scope} scope is required.`); return undefined; }
    return principal;
  };

  router.get("/proposals/review-queue", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:read");
    if (!principal) return;
    const role = actorRole(request, principal);
    if (role !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    const state = typeof request.query.state === "string" && request.query.state ? request.query.state : undefined;
    const proposals = await store.listProposals(state);
    const policy = await store.policy();
    ok(request, response, {
      states: policy.statuses.map((status) => ({ code: status.code, staffLabel: status.staffLabel, clientLabel: status.clientLabel })),
      items: proposals.map((proposal) => {
        const status = policy.statuses.find((item) => item.code === proposal.reviewState);
        return { id: proposal.id, title: proposal.title, state: proposal.reviewState, clientLabel: status?.clientLabel ?? proposal.reviewState, staffLabel: status?.staffLabel ?? proposal.reviewState, updatedAt: proposal.updatedAt.toISOString() };
      }),
    });
  }));

  router.get("/proposals/:id/review", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:read");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    ok(request, response, await workspaceFor(store, proposal.id, role));
  }));

  router.get("/proposals/:id/review/diff", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:read");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const from = Number(request.query.from);
    const to = Number(request.query.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) { fail(request, response, 400, "VALIDATION_FAILED", "Version numbers are required."); return; }
    ok(request, response, await diffVersions(store, proposal.id, from, to));
  }));

  router.post("/proposals/:id/review/transition", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = TransitionBody.parse(request.body ?? {});
    const policy = await store.policy();
    // Role before state: if no transition into the target is ever open to this role but one is open to staff, refuse with 403 whatever the proposal's current state.
    const roleCanReach = policy.transitions.some((item) => item.toStatus === body.to && item.actorRole === role);
    if (!roleCanReach && role !== "staff" && policy.transitions.some((item) => item.toStatus === body.to && item.actorRole === "staff")) { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    let target = body.to;
    let transition = policy.transitions.find((item) => item.fromStatus === proposal.reviewState && item.toStatus === target && item.actorRole === role);
    // Submitting again after changes were requested is a resubmission, so the submit tool works from either revision state.
    if (!transition && target === "agent_review") {
      const resubmit = policy.transitions.find((item) => item.fromStatus === proposal.reviewState && item.toStatus === "resubmitted" && item.actorRole === role);
      if (resubmit) { transition = resubmit; target = resubmit.toStatus; }
    }
    if (!transition) {
      const staffOnly = policy.transitions.some((item) => item.fromStatus === proposal.reviewState && item.toStatus === body.to && item.actorRole === "staff");
      if (staffOnly && role !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required.", { from: proposal.reviewState, to: body.to, role }); return; }
      const refusal = transitionRefusal(policy, proposal.reviewState, body.to, role);
      fail(request, response, refusal.status, refusal.code, refusal.message, refusal.details);
      return;
    }
    if (body.actions && !body.actions.includes(transition.action)) {
      fail(request, response, 409, "CONFLICT", `That review transition is not allowed: from ${proposal.reviewState}, moving to ${target} would ${transition.action}, not ${body.actions.join(" or ")}.`, { from: proposal.reviewState, to: target, action: transition.action, expected: body.actions });
      return;
    }
    if (transition.actorRole === "staff" && role !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    if (transition.locksVersion) {
      const steps = await prisma.proposalApprovalStep.findMany({ where: { proposalId: proposal.id }, include: { decision: true }, orderBy: { sortOrder: "asc" } });
      const waiting = remainingApprovals(steps.map((step) => ({ id: step.id, sortOrder: step.sortOrder, label: step.label, decided: Boolean(step.decision) })));
      if (waiting.length) { fail(request, response, 409, "APPROVAL_PENDING", `Approval is waiting on ${waiting.map((step) => step.label).join(", ")}.`, { remaining: waiting.map((step) => step.label) }); return; }
    }
    const result = await applyTransition(store, {
      proposalId: proposal.id,
      actorId: principal.userId,
      actorRole: role,
      toStatus: target,
      reasonCode: body.reasonCode,
      reasonText: body.reasonText,
      commentBody: body.commentBody,
      commentType: body.commentType,
      commentTargetKind: body.commentTargetKind,
      commentTargetId: body.commentTargetId,
      meeting: body.meetingAt ? { scheduledAt: new Date(body.meetingAt), link: body.meetingLink, notes: body.meetingNotes } : undefined,
    });
    if (target === "agent_review" || target === "resubmitted") {
      await stopTickler(prisma, proposal.id, "submitted");
      await noteGuidanceAction(prisma, { proposalId: proposal.id, sessionId: guidanceSessionId(request, principal.userId, proposal.id), actionTaken: "submitted", explicitTrigger: "submit_attempt" });
    }
    ok(request, response, { state: result.proposal.reviewState, version: result.version ? { id: result.version.id, number: result.version.number, locked: result.version.locked } : null }, true);
  }));

  router.post("/proposals/:id/review/comments", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = CommentBody.parse(request.body ?? {});
    const comment = await addComment(store, { proposalId: proposal.id, actorId: principal.userId, actorRole: role, body: body.body, typeCode: body.type, visibility: body.visibility, targetKind: body.targetKind, targetId: body.targetId, parentId: body.parentId });
    ok(request, response, { id: comment.id, visibility: comment.visibility, status: comment.status }, true, 201);
  }));

  router.post("/proposals/:id/review/comments/:commentId/resolve", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const commentId = param(request, "commentId");
    const before = (await store.listComments(proposal.id)).find((item) => item.id === commentId);
    const resolvedStatus = (await store.policy()).resolvedStatus;
    // Resolving an already-resolved comment is a no-op; report changed: false instead of claiming a change.
    if (before && before.status === resolvedStatus && role !== "client") { ok(request, response, { id: before.id, status: before.status }, false); return; }
    const comment = await resolveComment(store, { proposalId: proposal.id, commentId, actorRole: role });
    ok(request, response, { id: comment.id, status: comment.status }, true);
  }));

  router.patch("/proposals/:id/review/comments/:commentId", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = z.object({ body: z.string().min(1), supersede: z.boolean().optional() }).strict().parse(request.body ?? {});
    const revised = await reviseOwnComment(store, { proposalId: proposal.id, commentId: param(request, "commentId"), actorId: principal.userId, actorRole: role, body: body.body, supersede: body.supersede });
    ok(request, response, { id: revised.comment.id, status: revised.comment.status, body: revised.comment.body, successorId: revised.successor?.id ?? null }, true);
  }));

  router.post("/proposals/:id/review/flags", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = FlagBody.parse(request.body ?? {});
    const flag = await addFlag(store, { proposalId: proposal.id, actorId: principal.userId, actorRole: role, kind: body.kind, reason: body.reason, visibility: body.visibility, targetKind: body.targetKind, targetId: body.targetId });
    ok(request, response, { id: flag.id, status: flag.status, blocksApproval: flag.blocksApproval }, true, 201);
  }));

  router.post("/proposals/:id/review/flags/:flagId/resolve", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    const role = actorRole(request, principal);
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const flag = await resolveFlag(store, { proposalId: proposal.id, flagId: param(request, "flagId"), actorRole: role });
    ok(request, response, { id: flag.id, status: flag.status, kind: flag.kind, reason: flag.reason, automatic: flag.automatic, blocksApproval: flag.blocksApproval }, true);
  }));

  router.get("/proposals/:id/approval-steps", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:read");
    if (!principal) return;
    const proposal = await store.getProposal(param(request, "id"));
    const role = actorRole(request, principal);
    if (!proposal || !canSee(principal, proposal, role)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const steps = await prisma.proposalApprovalStep.findMany({ where: { proposalId: proposal.id }, include: { decision: true }, orderBy: { sortOrder: "asc" } });
    ok(request, response, { steps: steps.map((step) => ({ id: step.id, label: step.label, sortOrder: step.sortOrder, decided: Boolean(step.decision) })) });
  }));

  router.post("/proposals/:id/approval-steps", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    if (actorRole(request, principal) !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = z.object({ label: z.string().trim().min(1).max(120) }).strict().parse(request.body ?? {});
    const last = await prisma.proposalApprovalStep.findFirst({ where: { proposalId: proposal.id }, orderBy: { sortOrder: "desc" } });
    const created = await prisma.proposalApprovalStep.create({ data: { proposalId: proposal.id, sortOrder: (last?.sortOrder ?? 0) + 10, label: body.label } });
    ok(request, response, { id: created.id, label: created.label, sortOrder: created.sortOrder }, true);
  }));

  router.post("/proposals/:id/approvals", run(async (request, response) => {
    const principal = await auth(request, response, "proposals:write");
    if (!principal) return;
    if (actorRole(request, principal) !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
    const proposal = await store.getProposal(param(request, "id"));
    if (!proposal) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const body = z.object({ stepId: z.string().uuid() }).strict().parse(request.body ?? {});
    const step = await prisma.proposalApprovalStep.findFirst({ where: { id: body.stepId, proposalId: proposal.id }, include: { decision: true } });
    if (!step) { fail(request, response, 404, "NOT_FOUND", "That approval step was not found."); return; }
    if (step.decision) { ok(request, response, { stepId: step.id, label: step.label, decided: true }); return; }
    await prisma.proposalApproval.create({ data: { stepId: step.id, actorId: principal.userId } });
    ok(request, response, { stepId: step.id, label: step.label, decided: true }, true);
  }));

  return router;
}

export async function recordCommercialEdit(prisma: PrismaClient, proposalId: string, actor: { userId: string; role?: string }): Promise<void> {
  if (!("proposalReviewStatus" in prisma)) return;
  const role: ReviewActorRole = actor.role === "staff" ? "staff" : actor.role === "agent" ? "agent" : "client";
  await noteCommercialEdit(prismaReviewStore(prisma), proposalId, { userId: actor.userId, role });
}

export async function guardCommercialEdit(prisma: PrismaClient, proposalId: string, actor: { role?: string }): Promise<void> {
  if (!("proposalReviewStatus" in prisma)) return;
  const store = prismaReviewStore(prisma);
  const policy = await store.policy();
  const proposal = await store.getProposal(proposalId);
  if (!proposal) return;
  const status = policy.statuses.find((item) => item.code === proposal.reviewState);
  if (!status) return;
  if (status.terminal && proposal.reviewState !== "approved") throw new ReviewError(409, "CONFLICT", "A closed proposal cannot be edited.");
  const role: ReviewActorRole = actor.role === "staff" ? "staff" : actor.role === "agent" ? "agent" : "client";
  if (role === "client" && !status.clientEditable && proposal.reviewState !== "approved") throw new ReviewError(409, "SECTION_LOCKED", `This section is locked because the proposal is ${status.clientLabel.toLowerCase()}. Start a revision before editing it.`);
}

export type ProposalEditActor = { role?: string; reviewActor?: string };

function editRole(actor: ProposalEditActor): ReviewActorRole {
  if (actor.reviewActor === "agent") return "agent";
  return actor.role === "staff" ? "staff" : actor.role === "agent" ? "agent" : "client";
}

/**
 * Guards a write to proposal content: structured fields (scope, pricing, engagement, timeline, title) or one narrative part.
 * Throws ReviewError when the proposal is approved or closed, a touched part is locked on a version, or a client edits while the
 * proposal is with Unwhelm (clientEditableCheck). Staff and agent edits during review go ahead.
 */
export async function guardProposalEdit(prisma: PrismaClient, proposalId: string, actor: ProposalEditActor, input: { parts: string[]; part?: string; clientEditableCheck?: boolean }): Promise<void> {
  if (!("proposalReviewStatus" in prisma)) return;
  const store = prismaReviewStore(prisma);
  const policy = await store.policy();
  const proposal = await store.getProposal(proposalId);
  if (!proposal) return;
  const lockedParts = input.parts.length && "proposalNode" in prisma
    ? await prisma.proposalNode.findMany({ where: { proposalId, key: { in: input.parts }, lockedVersionId: { not: null } }, select: { key: true, lockedVersionId: true } })
    : [];
  const refusal = editRefusal(policy, proposal.reviewState, editRole(actor), { part: input.part, lockedParts, clientEditableCheck: input.clientEditableCheck });
  if (refusal) throw refusal;
}

/** Parts whose stored content a PATCH would actually change. Identical values are left out, so a retry is a no-op. */
export function changedProposalFields(old: Record<string, unknown>, next: Record<string, unknown>): string[] {
  return Object.keys(next).filter((key) => next[key] !== undefined && !sameContent(normalizeField(key, old[key]), normalizeField(key, next[key])));
}

export function partsForFields(fields: string[]): string[] {
  return [...new Set(fields.flatMap((field) => FIELD_PARTS[field] ?? []))];
}

function normalizeField(key: string, value: unknown): unknown {
  if (key !== "timeline" || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const timeline = value as Record<string, unknown>;
  // Milestone ids are generated on save, so compare milestones by what they say.
  const milestones = Array.isArray(timeline.milestones) ? timeline.milestones.map((item) => {
    if (!item || typeof item !== "object") return item;
    const { id: _id, weekOffset: _weekOffset, endsWeekLow: _endsWeekLow, endsWeekHigh: _endsWeekHigh, ...rest } = item as Record<string, unknown>;
    return { description: "", gate: "", weeksLow: null, weeksHigh: null, actualStart: null, actualEnd: null, ...rest, dueDate: rest.dueDate ?? null };
  }) : [];
  return { startDate: timeline.startDate ?? null, targetDate: timeline.targetDate ?? null, milestones };
}
