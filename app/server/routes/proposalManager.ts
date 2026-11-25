import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient, type ProposalRequirement } from "@prisma/client";
import { z } from "zod";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { contentExpired, insertRefusal, matchReason, upsertMode } from "../contentLibrary.js";
import { analyzeRfp, complianceMatrix, sectionHasContent } from "../rfpCompliance.js";
import { draftSection, libraryText } from "../libraryDraft.js";

type Principal = { userId: string; organizationId?: string; membershipRole?: "prospect" | "client" | "staff"; isAdmin: boolean; scopes: string[] | null };
type Options = { prisma: PrismaClient; authorize?: (request: Request) => Promise<Principal | undefined> };

const uuid = z.string().uuid();
const dateTime = z.string().datetime().optional().nullable();
const factor = z.object({ key: z.string().min(1), score: z.number().min(0).max(5), weight: z.number().positive().default(1), evidence: z.string().optional(), ownerId: uuid.optional(), mitigation: z.string().optional() }).strict();
const requirement = z.object({ text: z.string().min(1), requirementType: z.string().min(1).default("deliverable"), sourceReference: z.string().optional(), mandatory: z.boolean().default(false), confidence: z.number().min(0).max(1).default(1), ownerId: uuid.optional(), dueAt: dateTime }).strict();
const task = z.object({ title: z.string().min(1).max(300), description: z.string().max(4000).default(""), taskType: z.string().min(1).default("proposal"), priority: z.enum(["low", "normal", "high", "critical"]).default("normal"), ownerId: uuid.nullable().optional(), assigneeName: z.string().trim().min(1).max(200).nullable().optional(), assigneeEmail: z.string().email().nullable().optional(), side: z.enum(["us", "client"]).default("us"), sectionKey: z.string().max(100).nullable().optional(), requirementId: uuid.nullable().optional(), dependsOnTaskId: uuid.nullable().optional(), dueAt: dateTime }).strict();
const scope = z.object({ items: z.array(z.unknown()).default([]), assumptions: z.array(z.string()).default([]), exclusions: z.array(z.string()).default([]), risks: z.array(z.unknown()).default([]), status: z.enum(["draft", "baseline", "superseded"]).default("draft") }).strict();
const pricingLine = z.object({ label: z.string().min(1), quantity: z.number().nonnegative().default(1), unitPriceMinor: z.number().int().nonnegative(), costMinor: z.number().int().nonnegative().default(0), unit: z.string().default("item") }).strict();
const pricing = z.object({ currency: z.string().regex(/^[A-Z]{3}$/), lines: z.array(pricingLine).default([]), options: z.array(z.object({ label: z.string().min(1), priceDeltaMinor: z.number().int(), costDeltaMinor: z.number().int().default(0) }).strict()).default([]) }).strict();
const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;
const libraryWrite = z.object({
  stableKey: z.string().min(1).max(200).optional(),
  title: z.string().min(1).max(300),
  category: z.string().min(1).max(100),
  body: z.unknown(),
  tags: z.array(z.string().min(1).max(80)).max(30).default([]),
  clientLabel: z.string().max(200).nullable().optional(),
  guidance: z.string().max(4000).default(""),
  visibility: z.enum(["global", "organization", "client"]).default("organization"),
  source: z.string().max(300).nullable().optional(),
  industry: z.string().max(120).nullable().optional(),
  product: z.string().max(120).nullable().optional(),
  effectiveFrom: dateTime,
  expiresAt: dateTime,
  changeSummary: z.string().max(1000).default(""),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();

async function writeAudit(prisma: PrismaClient | Prisma.TransactionClient, event: { organizationId?: string | null; actorUserId: string; operation: string; path: string; recordId: string; requestId: string; input: Record<string, unknown> }) {
  const previous = await prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
  const previousHash = previous?.hash ?? null;
  await prisma.auditEvent.create({ data: { organizationId: event.organizationId ?? undefined, actorUserId: event.actorUserId, operation: event.operation, method: "POST", path: event.path, recordType: "content_library_item", recordId: event.recordId, requestId: event.requestId, inputRedacted: jsonValue(event.input), statusCode: 200, previousHash, hash: createHash("sha256").update(JSON.stringify({ previousHash, ...event.input, recordId: event.recordId })).digest("hex") } });
}

const idOf = (request: Request, name: string) => { const value = request.params[name]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; };
const requestId = (request: Request) => request.header("x-request-id") || randomUUID();
const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200) => response.status(status).json({ ok: true, changed, entity, warnings: [], links: {}, requestId: requestId(request) });
const fail = (request: Request, response: Response, status: number, code: string, message: string, details?: unknown) => response.status(status).json({ ok: false, code, message, ...(details === undefined ? {} : { details }), retryable: status >= 500, requestId: requestId(request) });

async function defaultAuthorize(prisma: PrismaClient, request: Request): Promise<Principal | undefined> {
  const header = request.header("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    const stored = await prisma.mcpToken.findFirst({ where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, include: { client: true, user: { include: { memberships: true } } } });
    if (!stored?.userId || !stored.user) return undefined;
    const membership = stored.user.memberships.find((item) => item.status === "active");
    return { userId: stored.userId, organizationId: stored.client.organizationId ?? membership?.organizationId ?? undefined, membershipRole: membership?.role, isAdmin: Boolean(stored.user.isAdmin), scopes: Array.isArray(stored.scopes) ? stored.scopes.filter((value): value is string => typeof value === "string") : [] };
  }
  const session = request.session?.userId;
  if (!session) return undefined;
  const user = await prisma.user.findUnique({ where: { id: session }, include: { memberships: true } });
  if (!user) return undefined;
  const membership = user.memberships.find((item) => item.status === "active");
  return { userId: session, organizationId: membership?.organizationId, membershipRole: membership?.role, isAdmin: Boolean(user.isAdmin), scopes: null };
}

function canSee(principal: Principal, proposal: { ownerId: string; organizationId: string | null }): boolean {
  return principal.isAdmin || principal.membershipRole === "staff" || proposal.ownerId === principal.userId || Boolean(principal.organizationId && proposal.organizationId === principal.organizationId);
}

function run(handler: (request: Request, response: Response, principal: Principal) => Promise<void>, prisma: PrismaClient, authorize: (request: Request) => Promise<Principal | undefined>, required: "proposals:read" | "proposals:write", staffOnly = false) {
  return async (request: Request, response: Response) => {
    try {
      const principal = await authorize(request);
      if (!principal) { fail(request, response, 401, "AUTH_REQUIRED", "Authentication is required."); return; }
      if (principal.scopes && !scopeAllows(principal.scopes, required)) { fail(request, response, 403, "SCOPE_REQUIRED", `The ${required} scope is required.`); return; }
      if (staffOnly && !principal.isAdmin && principal.membershipRole !== "staff") { fail(request, response, 403, "FORBIDDEN", "Staff authorization is required."); return; }
      await handler(request, response, principal);
    } catch (error) {
      if (error instanceof z.ZodError) { fail(request, response, 400, "VALIDATION_FAILED", "The request body is invalid.", error.issues); return; }
      console.error(error); fail(request, response, 500, "INTERNAL_ERROR", "The proposal-manager operation could not be completed.");
    }
  };
}

export function createProposalManagerRouter({ prisma, authorize: suppliedAuthorize }: Options): Router {
  const router = Router();
  const authorize = suppliedAuthorize ?? ((request: Request) => defaultAuthorize(prisma, request));
  const proposal = async (request: Request, response: Response, principal: Principal) => {
    const item = await prisma.proposal.findUnique({ where: { id: idOf(request, "id") }, select: { id: true, ownerId: true, organizationId: true } });
    if (!item || !canSee(principal, item)) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return undefined; }
    return item;
  };

  router.post("/proposals/:id/source-documents", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ fileName: z.string().min(1).max(300), mimeType: z.string().max(150).optional(), content: z.string().min(1).max(2_000_000), metadata: z.record(z.string(), z.unknown()).default({}) }).strict().parse(request.body ?? {});
    const created = await prisma.proposalSourceDocument.create({ data: { proposalId: item.id, fileName: body.fileName, mimeType: body.mimeType, content: body.content, metadata: jsonValue(body.metadata), createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/requirements/extract", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ sourceDocumentId: uuid.optional(), requirements: z.array(requirement).min(1).optional() }).strict().parse(request.body ?? {});
    let source: Awaited<ReturnType<typeof prisma.proposalSourceDocument.findFirst>> = null;
    if (body.sourceDocumentId) {
      source = await prisma.proposalSourceDocument.findFirst({ where: { id: body.sourceDocumentId, proposalId: item.id } });
      if (!source) { fail(request, response, 404, "NOT_FOUND", "The source document was not found."); return; }
    }
    const extracted: Array<z.infer<typeof requirement>> = body.requirements ?? (source?.content.split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text, requirementType: "unclassified", sourceReference: undefined, mandatory: false, confidence: 0.4, ownerId: undefined, dueAt: undefined })) ?? []);
    if (!extracted.length) { fail(request, response, 400, "VALIDATION_FAILED", "At least one requirement is required or the source document must contain text."); return; }
    const created = await prisma.$transaction(async (tx) => {
      const rows = await Promise.all(extracted.map((value) => tx.proposalRequirement.create({ data: { proposalId: item.id, sourceDocumentId: source?.id, text: value.text, requirementType: value.requirementType, sourceReference: value.sourceReference, mandatory: value.mandatory, confidence: value.confidence, confirmed: true, priority: value.mandatory ? "high" : "normal", ownerId: value.ownerId, dueAt: value.dueAt ? new Date(value.dueAt) : undefined } })));
      if (source) await tx.proposalSourceDocument.update({ where: { id: source.id }, data: { status: "extracted", extractedAt: new Date() } });
      return rows;
    });
    ok(request, response, { sourceDocumentId: source?.id ?? null, requirements: created }, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/requirements/analyze", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ sourceDocumentId: uuid.optional(), content: z.string().min(1).max(2_000_000).optional() }).strict().parse(request.body ?? {});
    const source = body.sourceDocumentId ? await prisma.proposalSourceDocument.findFirst({ where: { id: body.sourceDocumentId, proposalId: item.id } }) : null;
    if (body.sourceDocumentId && !source) { fail(request, response, 404, "NOT_FOUND", "The source document was not found."); return; }
    const content = body.content ?? source?.content ?? "";
    if (!content.trim()) { fail(request, response, 400, "VALIDATION_FAILED", "Provide RFP text or a stored source document."); return; }
    const nodes = await prisma.proposalNode.findMany({ where: { proposalId: item.id }, orderBy: { sortOrder: "asc" } });
    const sections = nodes.map((node) => ({ key: node.key, title: node.title, hasContent: sectionHasContent(node.body) }));
    const proposed = analyzeRfp(content, sections);
    if (!proposed.length) { fail(request, response, 400, "VALIDATION_FAILED", "No requirements were found in that text."); return; }
    const created = await prisma.$transaction(async (tx) => {
      const rows: ProposalRequirement[] = [];
      for (const value of proposed) {
        rows.push(await tx.proposalRequirement.create({ data: { proposalId: item.id, sourceDocumentId: source?.id, text: value.text, requirementType: value.requirementType, sourceReference: value.sourceReference, mandatory: value.mandatory, priority: value.priority, confidence: value.confidence, suggestedNodeKeys: value.suggestedNodeKeys, duplicateOfId: value.duplicateOfIndex !== null ? rows[value.duplicateOfIndex]?.id : undefined, confirmed: false, status: "unmapped" } }));
      }
      if (source) await tx.proposalSourceDocument.update({ where: { id: source.id }, data: { status: "analyzed", extractedAt: new Date() } });
      return rows;
    });
    ok(request, response, complianceMatrix(created.map((row) => ({ ...row, evidence: row.evidence })), sections), true, 201);
  }, prisma, authorize, "proposals:write"));

  router.get("/proposals/:id/requirements", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const mandatory = request.query.mandatory === "true" ? true : request.query.mandatory === "false" ? false : undefined;
    const items = await prisma.proposalRequirement.findMany({ where: { proposalId: item.id, ...(status ? { status } : {}), ...(mandatory === undefined ? {} : { mandatory }) }, orderBy: { createdAt: "asc" } });
    ok(request, response, { items });
  }, prisma, authorize, "proposals:read"));

  router.patch("/proposals/:id/requirements/:requirementId", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ text: z.string().min(1).optional(), requirementType: z.enum(["deliverable", "qualification", "format", "commercial", "legal", "security", "schedule", "question"]).optional(), sourceReference: z.string().max(300).optional(), mandatory: z.boolean().optional(), priority: z.enum(["low", "normal", "high", "critical"]).optional(), ownerId: uuid.nullable().optional(), dueAt: dateTime, confirmed: z.boolean().optional(), reviewNote: z.string().max(2000).optional() }).strict().parse(request.body ?? {});
    const existing = await prisma.proposalRequirement.findFirst({ where: { id: idOf(request, "requirementId"), proposalId: item.id } });
    if (!existing) { fail(request, response, 404, "NOT_FOUND", "The requirement was not found."); return; }
    const updated = await prisma.proposalRequirement.update({ where: { id: existing.id }, data: { ...body, ownerId: body.ownerId === null ? null : body.ownerId, dueAt: body.dueAt ? new Date(body.dueAt) : body.dueAt === null ? null : undefined } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/go-no-go", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ factors: z.array(factor).min(1), decision: z.enum(["go", "no_go", "go_with_conditions"]).optional(), rationale: z.string().max(4000).optional() }).strict().parse(request.body ?? {});
    if (body.decision && !principal.isAdmin && principal.membershipRole !== "staff") { fail(request, response, 403, "FORBIDDEN", "Only staff can record a go/no-go decision."); return; }
    const totalWeight = body.factors.reduce((sum, value) => sum + value.weight, 0);
    const score = Math.round(body.factors.reduce((sum, value) => sum + value.score * value.weight, 0) / totalWeight * 20);
    const created = await prisma.proposalGoNoGoAssessment.create({ data: { proposalId: item.id, factors: body.factors, score, decision: body.decision, status: body.decision ? "decided" : "draft", rationale: body.rationale, decidedById: body.decision ? principal.userId : undefined, decidedAt: body.decision ? new Date() : undefined, createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/tasks", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = task.parse(request.body ?? {});
    if (body.requirementId) { const found = await prisma.proposalRequirement.findFirst({ where: { id: body.requirementId, proposalId: item.id } }); if (!found) { fail(request, response, 400, "VALIDATION_FAILED", "The requirement does not belong to this proposal."); return; } }
    if (body.dependsOnTaskId) { const found = await prisma.proposalManagerTask.findFirst({ where: { id: body.dependsOnTaskId, proposalId: item.id } }); if (!found) { fail(request, response, 400, "VALIDATION_FAILED", "The dependency does not belong to this proposal."); return; } }
    if (body.side === "client" && !body.assigneeName) { fail(request, response, 400, "VALIDATION_FAILED", "A client task needs assigneeName. Use the role, such as NetSuite admin, when the person's name is unknown."); return; }
    const created = await prisma.proposalManagerTask.create({ data: { proposalId: item.id, title: body.title, description: body.description, taskType: body.taskType, priority: body.priority, ownerId: body.ownerId ?? undefined, assigneeName: body.assigneeName ?? undefined, assigneeEmail: body.assigneeEmail ?? undefined, side: body.side, sectionKey: body.sectionKey ?? undefined, requirementId: body.requirementId ?? undefined, dependsOnTaskId: body.dependsOnTaskId ?? undefined, dueAt: body.dueAt ? new Date(body.dueAt) : undefined, createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.get("/proposals/:id/tasks", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const tasks = await prisma.proposalManagerTask.findMany({ where: { proposalId: item.id, ...(status ? { status } : {}) }, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }] });
    ok(request, response, { items: tasks, overdue: tasks.filter((value) => value.dueAt && value.dueAt < new Date() && !["completed", "cancelled"].includes(value.status)).map((value) => value.id) });
  }, prisma, authorize, "proposals:read"));

  router.post("/proposals/:id/compliance-matrix", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ mappings: z.array(z.object({ requirementId: uuid, nodeKeys: z.array(z.string().min(1)).default([]), evidence: z.array(z.unknown()).default([]), status: z.enum(["unmapped", "in_progress", "addressed", "partially_addressed", "not_applicable", "accepted_risk"]).optional(), reviewNote: z.string().max(2000).optional() }).strict()).min(1) }).strict().parse(request.body ?? {});
    const updated = [];
    for (const mapping of body.mappings) {
      const existing = await prisma.proposalRequirement.findFirst({ where: { id: mapping.requirementId, proposalId: item.id } });
      if (!existing) { fail(request, response, 400, "VALIDATION_FAILED", `Requirement ${mapping.requirementId} does not belong to this proposal.`); return; }
      updated.push(await prisma.proposalRequirement.update({ where: { id: existing.id }, data: { mappedNodeKeys: mapping.nodeKeys, evidence: jsonValue(mapping.evidence), status: mapping.status ?? (mapping.nodeKeys.length ? "addressed" : "unmapped"), reviewNote: mapping.reviewNote } }));
    }
    ok(request, response, { requirements: updated }, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/requirements/:requirementId/mapping", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ nodeKeys: z.array(z.string().min(1)).min(1) }).strict().parse(request.body ?? {});
    const existing = await prisma.proposalRequirement.findFirst({ where: { id: idOf(request, "requirementId"), proposalId: item.id } });
    if (!existing) { fail(request, response, 404, "NOT_FOUND", "The requirement was not found."); return; }
    const nodes = await prisma.proposalNode.findMany({ where: { proposalId: item.id, key: { in: body.nodeKeys } } });
    if (nodes.length !== body.nodeKeys.length) { fail(request, response, 400, "VALIDATION_FAILED", "Every section key must belong to this proposal."); return; }
    const filled = nodes.every((node) => sectionHasContent(node.body));
    const updated = await prisma.proposalRequirement.update({ where: { id: existing.id }, data: { mappedNodeKeys: body.nodeKeys, status: filled ? "in_progress" : "partially_addressed" } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/requirements/:requirementId/evidence", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ kind: z.enum(["section", "attachment", "library", "note"]), ref: z.string().min(1).max(300), note: z.string().max(2000).optional() }).strict().parse(request.body ?? {});
    const existing = await prisma.proposalRequirement.findFirst({ where: { id: idOf(request, "requirementId"), proposalId: item.id } });
    if (!existing) { fail(request, response, 404, "NOT_FOUND", "The requirement was not found."); return; }
    const evidence = Array.isArray(existing.evidence) ? existing.evidence : [];
    const updated = await prisma.proposalRequirement.update({ where: { id: existing.id }, data: { evidence: jsonValue([...evidence, { ...body, actorId: principal.userId, createdAt: new Date().toISOString() }]) } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write"));

  router.get("/proposals/:id/compliance-matrix", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const [requirements, nodes, signoff] = await Promise.all([
      prisma.proposalRequirement.findMany({ where: { proposalId: item.id }, orderBy: { createdAt: "asc" } }),
      prisma.proposalNode.findMany({ where: { proposalId: item.id }, orderBy: { sortOrder: "asc" } }),
      prisma.proposalComplianceSignoff.findFirst({ where: { proposalId: item.id }, orderBy: { createdAt: "desc" } }),
    ]);
    const sections = nodes.map((node) => ({ key: node.key, title: node.title, hasContent: sectionHasContent(node.body) }));
    ok(request, response, { ...complianceMatrix(requirements, sections), signoff });
  }, prisma, authorize, "proposals:read"));

  router.post("/proposals/:id/compliance-signoff", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ note: z.string().max(2000).default("") }).strict().parse(request.body ?? {});
    const [requirements, nodes] = await Promise.all([
      prisma.proposalRequirement.findMany({ where: { proposalId: item.id } }),
      prisma.proposalNode.findMany({ where: { proposalId: item.id } }),
    ]);
    const matrix = complianceMatrix(requirements, nodes.map((node) => ({ key: node.key, title: node.title, hasContent: sectionHasContent(node.body) })));
    if (!matrix.readyForSignOff) { fail(request, response, 409, "COMPLIANCE_GAPS", "Mandatory requirements still need an accepted mapping.", { gaps: matrix.gaps }); return; }
    const signoff = await prisma.proposalComplianceSignoff.create({ data: { proposalId: item.id, note: body.note, signedById: principal.userId } });
    ok(request, response, { signoff, coverage: matrix.coverage }, true, 201);
  }, prisma, authorize, "proposals:write", true));

  router.post("/proposals/:id/sections/:nodeKey/draft", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const nodeKey = idOf(request, "nodeKey");
    const body = z.object({ apply: z.boolean().default(false) }).strict().parse(request.body ?? {});
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: item.id, key: nodeKey } });
    if (!node) { fail(request, response, 404, "NOT_FOUND", "The proposal section was not found."); return; }
    const spec = await prisma.proposalSectionSpec.findUnique({ where: { nodeKey } });
    const [requirements, library] = await Promise.all([
      prisma.proposalRequirement.findMany({ where: { proposalId: item.id } }),
      prisma.contentLibraryItem.findMany({ where: { AND: [libraryVisible(principal), { status: "approved" }] } }),
    ]);
    const now = new Date();
    const draft = draftSection(nodeKey, requirements, library.filter((row) => !contentExpired(row.expiresAt, now)).map((row) => ({ id: row.id, title: row.title, version: row.approvedVersion ?? row.version, bodyText: libraryText(row.body) })));
    if (!draft.text) { fail(request, response, 409, "NOTHING_TO_DRAFT", "No requirements point at this section yet. Analyze the RFP before drafting."); return; }
    if (spec && draft.text.length > spec.maxChars) { fail(request, response, 400, "VALIDATION_FAILED", `The draft is longer than the ${spec.maxChars} character limit for this section.`); return; }
    if (!body.apply) { ok(request, response, { ...draft, applied: false }); return; }
    if (node.lockedVersionId) { fail(request, response, 409, "SECTION_LOCKED", "This section is locked."); return; }
    const updated = await prisma.$transaction(async (tx) => {
      const written = await tx.proposalNode.update({ where: { id: node.id }, data: { body: { text: draft.text, updatedBy: principal.userId, updatedAt: new Date().toISOString(), citations: draft.citations, gaps: draft.gaps }, ...(spec ? { stateCode: spec.writtenState } : {}) } });
      for (const citation of draft.citations) {
        await tx.contentLibraryUse.create({ data: { itemId: citation.itemId, version: citation.version, proposalId: item.id, sectionKey: nodeKey, actorId: principal.userId } });
      }
      return written;
    });
    ok(request, response, { ...draft, applied: true, node: updated }, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/readiness", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const [requirements, tasks, goNoGo, pricing] = await Promise.all([
      prisma.proposalRequirement.findMany({ where: { proposalId: item.id } }),
      prisma.proposalManagerTask.findMany({ where: { proposalId: item.id } }),
      prisma.proposalGoNoGoAssessment.findFirst({ where: { proposalId: item.id }, orderBy: { createdAt: "desc" } }),
      prisma.proposalPricingModel.findFirst({ where: { proposalId: item.id }, orderBy: { version: "desc" } }),
    ]);
    const gaps = [
      ...requirements.filter((value) => value.mandatory && !["addressed", "not_applicable", "accepted_risk"].includes(value.status)).map((value) => ({ kind: "requirement", id: value.id, message: "Mandatory requirement is not addressed." })),
      ...tasks.filter((value) => ["blocked"].includes(value.status)).map((value) => ({ kind: "task", id: value.id, message: "Task is blocked." })),
      ...(goNoGo && !goNoGo.decision ? [{ kind: "go_no_go", id: goNoGo.id, message: "Go/no-go decision is not recorded." }] : []),
      ...(pricing && pricing.approvalStatus !== "approved" ? [{ kind: "pricing", id: pricing.id, message: "Pricing is not approved." }] : []),
    ];
    ok(request, response, { ready: gaps.length === 0, gaps, counts: { requirements: requirements.length, tasks: tasks.length } });
  }, prisma, authorize, "proposals:read"));

  const libraryVisible = (principal: Principal) => principal.isAdmin || principal.membershipRole === "staff"
    ? {}
    : { OR: [{ visibility: "global" }, { organizationId: null }, ...(principal.organizationId ? [{ organizationId: principal.organizationId }] : [])] };

  router.post("/content-library/items", run(async (request, response, principal) => {
    const body = libraryWrite.parse(request.body ?? {});
    if (body.visibility === "client" && !body.clientLabel) { fail(request, response, 400, "VALIDATION_FAILED", "Client-specific content needs a client label."); return; }
    if (body.visibility === "global" && !principal.isAdmin && principal.membershipRole !== "staff") { fail(request, response, 403, "FORBIDDEN", "Only staff can publish global library content."); return; }
    const organizationId = body.visibility === "global" ? null : principal.organizationId ?? null;
    const existing = body.stableKey ? await prisma.contentLibraryItem.findUnique({ where: { stableKey: body.stableKey }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }) : null;
    if (existing && existing.organizationId && existing.organizationId !== principal.organizationId && !principal.isAdmin && principal.membershipRole !== "staff") { fail(request, response, 404, "NOT_FOUND", "The library item was not found."); return; }
    if (existing && body.idempotencyKey) {
      const replay = await prisma.contentLibraryVersion.findFirst({ where: { itemId: existing.id, idempotencyKey: body.idempotencyKey } });
      if (replay) { ok(request, response, { item: existing, version: replay }); return; }
    }
    const pending = existing?.versions[0] && existing.versions[0].version !== existing.approvedVersion ? existing.versions[0].status : undefined;
    const mode = upsertMode(existing ? { status: existing.status, pending } : null);
    if (mode === "blocked") { fail(request, response, 409, "IN_REVIEW", "This item is in review. Approve or reject it before drafting another version."); return; }
    const versionFields = { title: body.title, body: jsonValue(body.body), guidance: body.guidance, tags: body.tags, changeSummary: body.changeSummary, authorId: principal.userId, idempotencyKey: body.idempotencyKey };
    const saved = await prisma.$transaction(async (tx) => {
      if (!existing || mode === "create") {
        const created = await tx.contentLibraryItem.create({ data: { organizationId, stableKey: body.stableKey ?? randomUUID(), title: body.title, category: body.category, body: jsonValue(body.body), tags: body.tags, clientLabel: body.clientLabel ?? undefined, guidance: body.guidance, visibility: body.visibility, source: body.source ?? undefined, industry: body.industry ?? undefined, product: body.product ?? undefined, status: "draft", version: 1, ownerId: principal.userId, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined, expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined } });
        const version = await tx.contentLibraryVersion.create({ data: { itemId: created.id, version: 1, status: "draft", ...versionFields } });
        await writeAudit(tx, { organizationId, actorUserId: principal.userId, operation: "content_library_upsert", path: "/content-library/items", recordId: created.id, requestId: requestId(request), input: { stableKey: created.stableKey, version: 1 } });
        return { item: created, version };
      }
      if (mode === "revise") {
        const versionNumber = existing.versions[0]?.version ?? existing.version;
        const keepApproved = Boolean(existing.approvedVersion);
        const item = keepApproved ? existing : await tx.contentLibraryItem.update({ where: { id: existing.id }, data: { title: body.title, category: body.category, body: jsonValue(body.body), tags: body.tags, clientLabel: body.clientLabel ?? undefined, guidance: body.guidance, visibility: body.visibility, source: body.source ?? undefined, industry: body.industry ?? undefined, product: body.product ?? undefined, status: "draft", effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined, expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined } });
        const version = existing.versions[0]
          ? await tx.contentLibraryVersion.update({ where: { id: existing.versions[0].id }, data: { ...versionFields, status: "draft" } })
          : await tx.contentLibraryVersion.create({ data: { itemId: existing.id, version: versionNumber, status: "draft", ...versionFields } });
        await writeAudit(tx, { organizationId: item.organizationId, actorUserId: principal.userId, operation: "content_library_upsert", path: "/content-library/items", recordId: item.id, requestId: requestId(request), input: { stableKey: item.stableKey, version: version.version } });
        return { item, version };
      }
      const nextVersion = (existing.versions[0]?.version ?? existing.version) + 1;
      const version = await tx.contentLibraryVersion.create({ data: { itemId: existing.id, version: nextVersion, status: "draft", ...versionFields } });
      await writeAudit(tx, { organizationId: existing.organizationId, actorUserId: principal.userId, operation: "content_library_draft_version", path: "/content-library/items", recordId: existing.id, requestId: requestId(request), input: { stableKey: existing.stableKey, version: nextVersion } });
      return { item: existing, version };
    });
    ok(request, response, saved, true, existing ? 200 : 201);
  }, prisma, authorize, "proposals:write"));

  router.get("/content-library/items/:itemId", run(async (request, response, principal) => {
    const item = await prisma.contentLibraryItem.findFirst({ where: { id: idOf(request, "itemId"), ...libraryVisible(principal) }, include: { versions: { orderBy: { version: "asc" } } } });
    if (!item) { fail(request, response, 404, "NOT_FOUND", "The library item was not found."); return; }
    const expired = item.status === "approved" && contentExpired(item.expiresAt);
    if (expired) await prisma.contentLibraryItem.update({ where: { id: item.id }, data: { status: "expired" } });
    ok(request, response, { ...item, status: expired ? "expired" : item.status, versions: item.versions });
  }, prisma, authorize, "proposals:read"));

  router.post("/content-library/items/:itemId/submit", run(async (request, response, principal) => {
    const item = await prisma.contentLibraryItem.findFirst({ where: { id: idOf(request, "itemId"), ...libraryVisible(principal) }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!item) { fail(request, response, 404, "NOT_FOUND", "The library item was not found."); return; }
    const latest = item.versions[0];
    if (!latest || latest.status !== "draft") { fail(request, response, 409, "NOT_DRAFT", "Only a draft version can be submitted for review."); return; }
    const version = await prisma.contentLibraryVersion.update({ where: { id: latest.id }, data: { status: "in_review" } });
    const updated = item.approvedVersion ? item : await prisma.contentLibraryItem.update({ where: { id: item.id }, data: { status: "in_review" } });
    await writeAudit(prisma, { organizationId: item.organizationId, actorUserId: principal.userId, operation: "content_library_submit", path: request.path, recordId: item.id, requestId: requestId(request), input: { version: version.version } });
    ok(request, response, { item: updated, version }, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/content-library/items/:itemId/approve", run(async (request, response, principal) => {
    const body = z.object({ decision: z.enum(["approve", "reject"]).default("approve"), note: z.string().max(1000).optional() }).strict().parse(request.body ?? {});
    const item = await prisma.contentLibraryItem.findUnique({ where: { id: idOf(request, "itemId") }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!item) { fail(request, response, 404, "NOT_FOUND", "The library item was not found."); return; }
    const latest = item.versions.find((version) => version.status === "in_review") ?? item.versions[0];
    if (!latest || latest.status !== "in_review") { fail(request, response, 409, "NOT_IN_REVIEW", "Submit the draft before approving or rejecting it."); return; }
    if (body.decision === "reject") {
      const version = await prisma.contentLibraryVersion.update({ where: { id: latest.id }, data: { status: "rejected", changeSummary: body.note ?? latest.changeSummary } });
      const updated = item.approvedVersion ? item : await prisma.contentLibraryItem.update({ where: { id: item.id }, data: { status: "rejected" } });
      await writeAudit(prisma, { organizationId: item.organizationId, actorUserId: principal.userId, operation: "content_library_reject", path: request.path, recordId: item.id, requestId: requestId(request), input: { version: version.version } });
      ok(request, response, { item: updated, version }, true);
      return;
    }
    const saved = await prisma.$transaction(async (tx) => {
      const previous = item.versions.find((version) => version.version === item.approvedVersion);
      if (previous) await tx.contentLibraryVersion.update({ where: { id: previous.id }, data: { supersededBy: latest.version, status: "approved" } });
      const version = await tx.contentLibraryVersion.update({ where: { id: latest.id }, data: { status: "approved", approvedById: principal.userId, approvedAt: new Date() } });
      const updated = await tx.contentLibraryItem.update({ where: { id: item.id }, data: { title: latest.title, body: jsonValue(latest.body), guidance: latest.guidance, tags: latest.tags, status: "approved", version: latest.version, approvedVersion: latest.version } });
      await writeAudit(tx, { organizationId: item.organizationId, actorUserId: principal.userId, operation: "content_library_approve", path: request.path, recordId: item.id, requestId: requestId(request), input: { version: latest.version } });
      return { item: updated, version };
    });
    ok(request, response, saved, true);
  }, prisma, authorize, "proposals:write", true));

  router.post("/content-library/items/:itemId/archive", run(async (request, response, principal) => {
    const item = await prisma.contentLibraryItem.findUnique({ where: { id: idOf(request, "itemId") } });
    if (!item) { fail(request, response, 404, "NOT_FOUND", "The library item was not found."); return; }
    const updated = await prisma.contentLibraryItem.update({ where: { id: item.id }, data: { status: "archived" } });
    await writeAudit(prisma, { organizationId: item.organizationId, actorUserId: principal.userId, operation: "content_library_archive", path: request.path, recordId: item.id, requestId: requestId(request), input: { stableKey: item.stableKey } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write", true));

  router.post("/content-library/search", run(async (request, response, principal) => {
    const body = z.object({ query: z.string().max(300).optional(), category: z.string().max(100).optional(), clientLabel: z.string().max(200).optional(), industry: z.string().max(120).optional(), product: z.string().max(120).optional(), status: z.enum(["draft", "in_review", "approved", "rejected", "expired", "archived"]).optional(), tags: z.array(z.string()).default([]), limit: z.number().int().min(1).max(100).default(20) }).strict().parse(request.body ?? {});
    const staff = principal.isAdmin || principal.membershipRole === "staff";
    const status = staff && body.status ? body.status : "approved";
    const filters: Prisma.ContentLibraryItemWhereInput[] = [libraryVisible(principal), status === "expired" ? { OR: [{ status: "expired" }, { status: "approved", expiresAt: { lt: new Date() } }] } : { status }];
    if (body.category) filters.push({ category: body.category });
    if (body.clientLabel) filters.push({ clientLabel: body.clientLabel });
    if (body.industry) filters.push({ industry: body.industry });
    if (body.product) filters.push({ product: body.product });
    if (body.query) filters.push({ OR: [{ title: { contains: body.query, mode: "insensitive" } }, { guidance: { contains: body.query, mode: "insensitive" } }] });
    const rows = await prisma.contentLibraryItem.findMany({ where: { AND: filters }, orderBy: { updatedAt: "desc" }, take: body.limit });
    const now = new Date();
    const visible = rows.filter((row) => body.tags.every((tag) => row.tags.includes(tag))).filter((row) => body.status === "expired" || !contentExpired(row.expiresAt, now));
    ok(request, response, { items: visible.map((row) => ({ ...row, expired: contentExpired(row.expiresAt, now), matchReason: matchReason(row, body, now) })), query: body.query ?? null });
  }, prisma, authorize, "proposals:read"));

  router.post("/proposals/:id/content-library/insert", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ itemId: uuid, nodeKey: z.string().min(1) }).strict().parse(request.body ?? {});
    const library = await prisma.contentLibraryItem.findFirst({ where: { id: body.itemId, ...libraryVisible(principal) } });
    const refusal = library ? insertRefusal(library) : "Only approved, non-expired content can be inserted.";
    if (!library || refusal) { fail(request, response, 409, "CONTENT_NOT_AVAILABLE", refusal ?? "Only approved, non-expired content can be inserted."); return; }
    const node = await prisma.proposalNode.findFirst({ where: { proposalId: item.id, key: body.nodeKey } });
    if (!node) { fail(request, response, 404, "NOT_FOUND", "The proposal section was not found."); return; }
    const approved = library.body && typeof library.body === "object" && !Array.isArray(library.body) ? library.body : { text: String(library.body) };
    const copied = structuredClone(approved);
    const updated = await prisma.$transaction(async (tx) => {
      const nodeRow = await tx.proposalNode.update({ where: { id: node.id }, data: { body: copied } });
      const use = await tx.contentLibraryUse.create({ data: { itemId: library.id, version: library.approvedVersion ?? library.version, proposalId: item.id, sectionKey: body.nodeKey, actorId: principal.userId } });
      await writeAudit(tx, { organizationId: library.organizationId, actorUserId: principal.userId, operation: "content_library_insert", path: request.path, recordId: library.id, requestId: requestId(request), input: { proposalId: item.id, sectionKey: body.nodeKey, version: use.version } });
      return { node: nodeRow, use };
    });
    ok(request, response, { node: updated.node, source: { id: library.id, version: library.approvedVersion ?? library.version, title: library.title, useId: updated.use.id } }, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/scope-baselines", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = scope.parse(request.body ?? {});
    const latest = await prisma.proposalScopeBaseline.findFirst({ where: { proposalId: item.id }, orderBy: { version: "desc" } });
    const created = await prisma.proposalScopeBaseline.create({ data: { proposalId: item.id, version: (latest?.version ?? 0) + 1, status: body.status, items: jsonValue(body.items), assumptions: jsonValue(body.assumptions), exclusions: jsonValue(body.exclusions), risks: jsonValue(body.risks), createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/pricing-models", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = pricing.parse(request.body ?? {});
    const latest = await prisma.proposalPricingModel.findFirst({ where: { proposalId: item.id }, orderBy: { version: "desc" } });
    const subtotal = body.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceMinor), 0);
    const cost = body.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.costMinor), 0);
    const optionTotal = body.options.reduce((sum, option) => sum + option.priceDeltaMinor, 0);
    const total = subtotal + optionTotal;
    const marginPercent = total > 0 ? Math.round(((total - cost) / total) * 10000) / 100 : null;
    const created = await prisma.proposalPricingModel.create({ data: { proposalId: item.id, version: (latest?.version ?? 0) + 1, currency: body.currency, lines: jsonValue(body.lines), options: jsonValue(body.options), totals: jsonValue({ subtotalMinor: subtotal, optionTotalMinor: optionTotal, totalMinor: total, costMinor: cost, marginPercent }), createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/commercial-validation", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ pricingModelId: uuid.optional(), minimumMarginPercent: z.number().min(0).max(100).default(0), maximumDiscountPercent: z.number().min(0).max(100).default(100) }).strict().parse(request.body ?? {});
    const model = body.pricingModelId ? await prisma.proposalPricingModel.findFirst({ where: { id: body.pricingModelId, proposalId: item.id } }) : await prisma.proposalPricingModel.findFirst({ where: { proposalId: item.id }, orderBy: { version: "desc" } });
    if (!model) { fail(request, response, 404, "NOT_FOUND", "No pricing model exists for this proposal."); return; }
    const totals = (model.totals && typeof model.totals === "object" && !Array.isArray(model.totals)) ? model.totals as { marginPercent?: unknown; totalMinor?: unknown } : {};
    const margin = typeof totals.marginPercent === "number" ? totals.marginPercent : null;
    const warnings = margin !== null && margin < body.minimumMarginPercent ? ["The pricing model is below the configured minimum margin."] : [];
    ok(request, response, { pricingModelId: model.id, valid: warnings.length === 0, warnings, marginPercent: margin, totalMinor: totals.totalMinor ?? null });
  }, prisma, authorize, "proposals:read"));

  router.get("/proposals/:id/pending-decisions", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const [requirements, tasks, assessment, pricing] = await Promise.all([
      prisma.proposalRequirement.findMany({ where: { proposalId: item.id, OR: [{ status: "unmapped" }, { status: "partially_addressed" }] }, orderBy: { mandatory: "desc" } }),
      prisma.proposalManagerTask.findMany({ where: { proposalId: item.id, status: { in: ["open", "blocked"] } }, orderBy: { dueAt: "asc" } }),
      prisma.proposalGoNoGoAssessment.findFirst({ where: { proposalId: item.id }, orderBy: { createdAt: "desc" } }),
      prisma.proposalPricingModel.findFirst({ where: { proposalId: item.id }, orderBy: { version: "desc" } }),
    ]);
    ok(request, response, { requirements, tasks, goNoGo: assessment && !assessment.decision ? assessment : null, pricing: pricing && pricing.approvalStatus !== "approved" ? pricing : null });
  }, prisma, authorize, "proposals:read"));

  const changeWrite = z.object({
    kind: z.enum(["pushback_deadline", "pushback", "change_request"]),
    summary: z.string().trim().min(1).max(300),
    detail: z.string().max(4000).default(""),
    approverName: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime().nullable().optional(),
  }).strict();

  router.post("/proposals/:id/guest-invites", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ name: z.string().trim().min(1).max(200), email: z.string().email(), taskTitle: z.string().trim().min(1).max(300).optional(), taskDetail: z.string().max(4000).optional() }).strict().parse(request.body ?? {});
    const createdTask = body.taskTitle ? await prisma.proposalManagerTask.create({ data: { proposalId: item.id, title: body.taskTitle, description: body.taskDetail ?? "", taskType: "client", side: "client", assigneeName: body.name, assigneeEmail: body.email, createdById: principal.userId } }) : null;
    const email = body.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser?.suspendedAt) { fail(request, response, 403, "FORBIDDEN", "That person cannot be added to the portal."); return; }
    const viewer = existingUser ?? await prisma.user.create({ data: { email, displayName: body.name } });
    const invite = await prisma.proposalGuestInvite.create({ data: { proposalId: item.id, userId: viewer.id, name: body.name, email, taskId: createdTask?.id, status: "active", createdById: principal.userId } });
    ok(request, response, { invite, task: createdTask, sent: false, portalAccess: "view" }, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/save-as-template", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,62}$/), name: z.string().trim().min(1).max(200) }).strict().parse(request.body ?? {});
    if (await prisma.proposalTemplate.findUnique({ where: { code: body.code } })) { fail(request, response, 409, "CONFLICT", "A template with that code already exists."); return; }
    const source = await prisma.proposal.findUnique({ where: { id: item.id }, include: { nodes: { orderBy: { sortOrder: "asc" } }, milestones: true, roles: true } });
    if (!source) { fail(request, response, 404, "NOT_FOUND", "The proposal was not found."); return; }
    const last = await prisma.proposalTemplate.aggregate({ _max: { sortOrder: true } });
    const outline = { milestones: source.milestones, roles: source.roles, scope: source.scope };
    await prisma.$transaction(async (tx) => {
      await tx.proposalTemplate.create({ data: { code: body.code, name: body.name, description: source.title, sortOrder: (last._max.sortOrder ?? 0) + 10, active: false, suggestedPricingModel: source.pricingModel, outline: jsonValue(outline) } });
      for (const [index, node] of source.nodes.entries()) {
        await tx.proposalNodeTemplate.upsert({ where: { key: node.key }, create: { key: node.key, kind: node.kind, title: node.title, clientLabel: node.clientLabel, sortOrder: node.sortOrder, parentKey: node.parentKey }, update: {} });
        await tx.proposalTemplateNode.create({ data: { templateCode: body.code, nodeKey: node.key, sortOrder: (index + 1) * 10, parentKey: node.parentKey } });
        const text = node.body && typeof node.body === "object" && !Array.isArray(node.body) ? (node.body as { text?: unknown }).text : undefined;
        if (typeof text === "string" && text.trim()) await tx.proposalTemplateSample.create({ data: { templateCode: body.code, nodeKey: node.key, content: jsonValue({ text }) } });
      }
    });
    ok(request, response, { code: body.code, name: body.name, active: false, parts: source.nodes.length }, true, 201);
  }, prisma, authorize, "proposals:write", true));

  router.post("/proposals/:id/change-items", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = changeWrite.parse(request.body ?? {});
    const created = await prisma.proposalChangeItem.create({ data: { proposalId: item.id, kind: body.kind, summary: body.summary, detail: body.detail, approverName: body.approverName, dueAt: body.dueAt ? new Date(body.dueAt) : null, createdById: principal.userId } });
    ok(request, response, created, true, 201);
  }, prisma, authorize, "proposals:write"));

  router.get("/proposals/:id/change-items", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const items = await prisma.proposalChangeItem.findMany({ where: { proposalId: item.id }, orderBy: { createdAt: "asc" } });
    ok(request, response, { items });
  }, prisma, authorize, "proposals:read"));

  router.patch("/proposals/:id/change-items/:itemId", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ dueAt: z.string().datetime().nullable(), approverName: z.string().trim().min(1).max(200).optional() }).strict().parse(request.body ?? {});
    const current = await prisma.proposalChangeItem.findFirst({ where: { id: idOf(request, "itemId"), proposalId: item.id } });
    if (!current) { fail(request, response, 404, "NOT_FOUND", "The change item was not found."); return; }
    const updated = await prisma.proposalChangeItem.update({ where: { id: current.id }, data: { dueAt: body.dueAt ? new Date(body.dueAt) : null, ...(body.approverName ? { approverName: body.approverName } : {}) } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write"));

  router.post("/proposals/:id/change-items/:itemId/decision", run(async (request, response, principal) => {
    const item = await proposal(request, response, principal); if (!item) return;
    const body = z.object({ decision: z.enum(["approved", "declined"]), note: z.string().max(2000).optional() }).strict().parse(request.body ?? {});
    const current = await prisma.proposalChangeItem.findFirst({ where: { id: idOf(request, "itemId"), proposalId: item.id } });
    if (!current) { fail(request, response, 404, "NOT_FOUND", "The change item was not found."); return; }
    if (current.kind === "pushback_deadline") { fail(request, response, 409, "CONFLICT", "A deadline is not decided. Record a pushback or a change request."); return; }
    if (current.status !== "open") { ok(request, response, current, false); return; }
    const updated = await prisma.proposalChangeItem.update({ where: { id: current.id }, data: { status: body.decision, decision: body.decision, decisionNote: body.note ?? null, decidedAt: new Date() } });
    ok(request, response, updated, true);
  }, prisma, authorize, "proposals:write"));

  return router;
}
