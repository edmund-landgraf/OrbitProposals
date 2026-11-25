import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { Request, Response } from "express";
import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  BillingScheduleError,
  IdSchema,
  ProposalDocumentSchema,
  ProposalOptionSchema,
  contractSignedInvoiceAmount,
  formatBillingPercent,
} from "../../packages/shapes/src/index.js";
import { loadActiveCatalog, parseCatalogPricing, scheduleFromCatalog, signingInvoiceDue, templateIdFor } from "../catalog.js";
import { ReviewError, applyTransition } from "../proposalReview.js";
import { guardCommercialEdit, recordCommercialEdit } from "./proposalReview.js";
import { lockedPricing, prismaReviewStore } from "../proposalReviewStore.js";
import { scopeAllows } from "../../shared/mcpScopes.js";
import { applyOpenCredits, issueWorkflowCheckCredit, supportsCredits } from "../credits.js";
import { AcceptError, acceptProposal, previewCommitment, releaseRetainage } from "../proposalAccept.js";
import { CompletionError } from "../completionTree.js";
import { applyChange, previewChange, prismaCompletionStore } from "../proposalCompletion.js";
import { applyOptionSelection, totalWithOptions } from "../optionPackages.js";
import { guidanceSessionId, noteGuidanceAction } from "../guidanceTurn.js";
import { stopTickler } from "../reminderDelivery.js";
import { renderPdf, PdfRenderError } from "../pdf/pdfRender.js";
import { redlineDocx, snapshotText } from "../docxRedline.js";
import { contractPdfHtml, proposalPdfHtml, type ContractPdfModel, type ProposalPdfModel } from "../pdf/templates.js";
import { signContract as signContractHelper } from "../contracts/signContract.js";
import { esignRuntime } from "../esign/index.js";
import { reconcileEsignWebhook, sendContractForEsign } from "../esign/esignService.js";
import { pandaDocWebhookDocumentId, verifyPandaDocWebhookSignature } from "../esign/providers/pandadocWebhook.js";
import { signwellWebhookDocumentId, verifySignWellWebhookSignature } from "../esign/providers/signwellWebhook.js";
import { redactProviderStatus } from "../esign/redact.js";
import { blockedAddress } from "../publicUrl.js";
import { PhaseEstimateSchema, TimelineWriteSchema, milestoneTableRow, milestoneViews, planTimelineWrite, splitEngagementRange } from "../proposalTimeline.js";
import { RolesReplaceSchema, parseHeaviest, roleView } from "../proposalRoles.js";
import { markWrittenParts, writtenKeysForPatch } from "../proposalWrittenState.js";
import { proposalLinks, proposalPortalUrl, webPublicUrl } from "../publicUrls.js";
import { EXPORT_FORMATS, exportExtras, parseExportFormat, proposalMarkdown } from "../proposalExport.js";
import {
  AttachmentError,
  AttachmentOrderSchema,
  AttachmentReplaceSchema,
  AttachmentWriteSchema,
  attachmentMetadataSelect,
  attachmentView,
  parseAttachmentPayload,
  parseLinkedDocument,
  parseUploadPart,
  sameIdSet,
  validateAttachmentBytes,
  type AttachmentRecord,
} from "../proposalAttachments.js";

type Role = "prospect" | "client" | "staff";

export type ProposalContractPrincipal = {
  userId: string;
  organizationId?: string;
  role?: Role;
  /** Signed-in coworker invited to view specific proposals. Reads are limited to those invites. */
  guestViewer?: boolean;
};

export type ProposalContractAuthorization = (
  request: Request,
  requirement: { scope: string; staff?: boolean },
) => Promise<ProposalContractPrincipal>;

export type ProposalContractRouterOptions = {
  prisma: PrismaClient;
  authorize?: ProposalContractAuthorization;
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const requestId = (request: Request): string => {
  const supplied = request.header("x-request-id");
  return supplied && IdSchema.safeParse(supplied).success ? supplied : randomUUID();
};

const pathParam = (request: Request, name: string): string => {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};

const ok = (request: Request, response: Response, entity: unknown, changed = false, status = 200, links: Record<string, string> = {}, warnings: Array<{ code: string; message: string; path?: string }> = []) =>
  response.status(status).json({ ok: true, changed, entity, warnings, links: Object.keys(links).length ? links : proposalLinks(entity), requestId: requestId(request) });

const fail = (request: Request, response: Response, status: number, code: string, message: string, details?: unknown[]) =>
  response.status(status).json({ ok: false, code, message, retryable: status >= 500, details, requestId: requestId(request) });

const defaultAuthorize = (prisma: PrismaClient): ProposalContractAuthorization => async (request, requirement) => {
  // Bearer callers (MCP, scripted runs) are checked against their token scopes and the token user's membership.
  if (request.header("authorization")?.startsWith("Bearer ")) return bearerPrincipal(prisma, request, requirement);
  const userId = request.session?.userId;
  if (!userId) throw new RouteError(401, "AUTH_REQUIRED", "Authentication is required.");
  const membership = request.session?.organizationId
    ? await prisma.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: request.session.organizationId } } })
    : await prisma.membership.findFirst({ where: { userId, status: "active" }, orderBy: { organizationId: "asc" } });
  if (!membership || membership.status !== "active") {
    if (!requirement.scope.endsWith(":write") && !requirement.staff) {
      const invite = await prisma.proposalGuestInvite.findFirst({ where: { userId, status: "active" }, select: { id: true } });
      if (invite) return { userId, role: "prospect", guestViewer: true };
    }
    throw new RouteError(403, "FORBIDDEN", "An active organization membership is required.");
  }
  if (requirement.staff && membership.role !== "staff") throw new RouteError(403, "FORBIDDEN", "Staff authorization is required.");
  return { userId, organizationId: membership.organizationId, role: membership.role };
};

const isUniqueViolation = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "P2002") return true;
  return "cause" in error ? isUniqueViolation(error.cause) : false;
};

/** MCP and other bearer callers must present contracts:write. Session callers stay on the membership check. */
const bearerContractSigner = async (prisma: PrismaClient, request: Request): Promise<ProposalContractPrincipal> => {
  const token = request.header("authorization")?.slice("Bearer ".length).trim() ?? "";
  if (!token) throw new RouteError(401, "AUTH_REQUIRED", "Authentication is required.");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const stored = await prisma.mcpToken.findFirst({
    where: { tokenHash, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { client: true, user: { include: { memberships: true } } },
  });
  if (!stored?.userId || !stored.user) throw new RouteError(401, "AUTH_REQUIRED", "Authentication is required.");
  const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  if (!scopeAllows(scopes, "contracts:write")) throw new RouteError(403, "SCOPE_REQUIRED", "The contracts:write scope is required.");
  const active = stored.user.memberships.filter((item) => item.status === "active");
  // The token client may name an organization. That is the caller's org only when they are actually a member of it.
  const hinted = stored.client.organizationId ? active.find((item) => item.organizationId === stored.client.organizationId) : undefined;
  const membership = hinted ?? active[0];
  return {
    userId: stored.userId,
    organizationId: membership?.organizationId,
    role: membership?.role,
  };
};

type PartyMembership = { status?: string; role?: string; organizationId?: string };
type PartyLookup = {
  findUnique?: (args: { where: { userId_organizationId: { userId: string; organizationId: string } } }) => Promise<PartyMembership | null>;
  findFirst?: (args: { where: { userId: string; organizationId: string; status: "active" } }) => Promise<PartyMembership | null>;
};

/**
 * A client is a party to a contract when they hold an active client or staff
 * membership in the contract's organization. The contract is with that
 * organization; there is no separate signer row. Callers with no membership
 * delegate (injected test auth) are a party of principal.organizationId.
 */
const clientIsContractParty = async (prisma: PrismaClient, principal: ProposalContractPrincipal, organizationId: string): Promise<boolean> => {
  if (principal.role === "prospect") return false;
  const membership = (prisma as unknown as { membership?: PartyLookup }).membership;
  if (!membership?.findUnique && !membership?.findFirst) return principal.organizationId === organizationId;
  const row = membership.findUnique
    ? await membership.findUnique({ where: { userId_organizationId: { userId: principal.userId, organizationId } } })
    : await membership.findFirst!({ where: { userId: principal.userId, organizationId, status: "active" } });
  if (!row || row.status !== "active" || row.role === "prospect") return false;
  if (row.organizationId && row.organizationId !== organizationId) return false;
  return row.role === undefined || row.role === "client" || row.role === "staff";
};

const clientContractToSign = async (prisma: PrismaClient, principal: ProposalContractPrincipal, id: string) => {
  const current = await prisma.contract.findFirstOrThrow({ where: { id }, include: { entries: true, proposal: true } });
  if (!(await clientIsContractParty(prisma, principal, current.organizationId))) {
    throw new RouteError(403, "FORBIDDEN", "You can only sign a contract you are a party to.");
  }
  return current;
};

const bearerPrincipal = async (prisma: PrismaClient, request: Request, requirement: { scope: string; staff?: boolean }): Promise<ProposalContractPrincipal> => {
  const token = request.header("authorization")?.slice("Bearer ".length).trim() ?? "";
  const stored = token ? await prisma.mcpToken.findFirst({
    where: { tokenHash: createHash("sha256").update(token).digest("hex"), revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { client: true, user: { include: { memberships: true } } },
  }) : null;
  if (!stored?.userId || !stored.user) throw new RouteError(401, "AUTH_REQUIRED", "Authentication is required.");
  const scopes = Array.isArray(stored.scopes) ? stored.scopes.filter((scope): scope is string => typeof scope === "string") : [];
  if (!scopeAllows(scopes, requirement.scope)) throw new RouteError(403, "SCOPE_REQUIRED", `The ${requirement.scope} scope is required.`);
  const orgId = stored.client.organizationId;
  const membership = stored.user.memberships.find((item) => item.status === "active" && (!orgId || item.organizationId === orgId));
  if (!membership) throw new RouteError(403, "FORBIDDEN", "An active organization membership is required.");
  if (requirement.staff && membership.role !== "staff") throw new RouteError(403, "FORBIDDEN", "Staff authorization is required.");
  return { userId: stored.userId, organizationId: membership.organizationId, role: membership.role };
};

class RouteError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown[]) { super(message); }
}

const run = (handler: (request: Request, response: Response) => Promise<void>) => async (request: Request, response: Response) => {
  try { await handler(request, response); }
  catch (error) {
    if (error instanceof RouteError || error instanceof ReviewError || error instanceof AcceptError || error instanceof CompletionError || error instanceof AttachmentError) { fail(request, response, error.status, error.code, error.message, error instanceof RouteError || error instanceof AttachmentError ? error.details : undefined); return; }
    const prismaCode = (error as { code?: string }).code;
    if (prismaCode === "P2025") { fail(request, response, 404, "NOT_FOUND", "The requested record was not found."); return; }
    if (prismaCode === "P2002") { fail(request, response, 409, "CONFLICT", "A document with that filename already exists on this proposal."); return; }
    console.error(error);
    fail(request, response, 500, "INTERNAL_ERROR", "The request could not be completed.");
  }
};

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new RouteError(400, "VALIDATION_FAILED", "The request body is invalid.", result.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })));
  return result.data as T;
};

const dateOnly = (value: Date | string | null | undefined): string | null => value ? new Date(value).toISOString().slice(0, 10) : null;
const timestamp = (value: Date | null | undefined): string | null => value ? value.toISOString() : null;
const prismaJson = (value: unknown) => value as Prisma.InputJsonValue;
const publicTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

const proposalInclude = { options: { include: { group: true } }, optionGroups: true, milestones: true } as const;
type ProposalWithRelations = Prisma.ProposalGetPayload<{ include: typeof proposalInclude }>;

const proposalDocument = (proposal: ProposalWithRelations) => {
  const scope = jsonObject(proposal.scope);
  const timeline = jsonObject(proposal.timeline);
  const document = {
    schemaVersion: 1 as const,
    id: proposal.id,
    organizationId: proposal.organizationId,
    ownerId: proposal.ownerId,
    title: proposal.title,
    engagement: proposal.engagement,
    status: proposal.status,
    scope: {
      summary: typeof scope.summary === "string" ? scope.summary : "",
      deliverables: Array.isArray(scope.deliverables) ? scope.deliverables : [],
      assumptions: Array.isArray(scope.assumptions) ? scope.assumptions : [],
      exclusions: Array.isArray(scope.exclusions) ? scope.exclusions : [],
    },
    timeline: {
      startDate: typeof timeline.startDate === "string" ? timeline.startDate : null,
      targetDate: typeof timeline.targetDate === "string" ? timeline.targetDate : null,
      milestones: milestoneViews(proposal.milestones, proposal.timeline),
    },
    pricing: jsonObject(proposal.pricing),
    options: proposal.options.map((option) => ({ id: option.id, label: option.label, description: option.description, priceDelta: { amountMinor: option.priceDeltaMinor, currency: option.priceCurrency }, selected: option.selected, selection: option.selection ?? "optional", groupId: option.groupId ?? null, groupName: option.group?.name ?? null, groupMode: option.group?.mode ?? null })),
    version: proposal.version,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  };
  return ProposalDocumentSchema.parse(document);
};

const proposalWhere = (id: string, principal: ProposalContractPrincipal) => principal.guestViewer
  ? { id, guestInvites: { some: { userId: principal.userId, status: "active" } } }
  : { id, ...(principal.organizationId ? { organizationId: principal.organizationId } : { ownerId: principal.userId }) };
const requireOrganization = (principal: ProposalContractPrincipal) => {
  if (!principal.organizationId) throw new RouteError(403, "FORBIDDEN", "An organization context is required.");
  return principal.organizationId;
};

const optionInput = (option: { label: string; description: string; priceDelta: { amountMinor: number; currency: string }; selected: boolean }) => ({ label: option.label, description: option.description, priceDeltaMinor: option.priceDelta.amountMinor, priceCurrency: option.priceDelta.currency, selected: option.selected });

const quotedTotal = (proposal: { pricing: unknown; options: Array<{ selected: boolean; priceDeltaMinor: number }> }) => {
  const pricing = proposal.pricing as { amountMinor?: unknown };
  const base = typeof pricing.amountMinor === "number" ? pricing.amountMinor : 0;
  return totalWithOptions(base, proposal.options.map((option) => ({ id: "", selection: "", groupId: null, priceDeltaMinor: option.priceDeltaMinor, selected: option.selected })));
};
const milestoneInput = (milestone: { title: string; description: string; dueDate: string | null; weeksLow?: number | null; weeksHigh?: number | null; hoursLow?: number | null; hoursHigh?: number | null; gate?: string; actualStart?: string | null; actualEnd?: string | null }) => ({
  title: milestone.title,
  description: milestone.description,
  dueDate: milestone.dueDate ? new Date(`${milestone.dueDate}T00:00:00.000Z`) : null,
  weeksLow: milestone.weeksLow ?? null,
  weeksHigh: milestone.weeksHigh ?? null,
  hoursLow: milestone.hoursLow ?? null,
  hoursHigh: milestone.hoursHigh ?? null,
  gate: milestone.gate ?? "",
  actualStart: milestone.actualStart ? new Date(`${milestone.actualStart}T00:00:00.000Z`) : null,
  actualEnd: milestone.actualEnd ? new Date(`${milestone.actualEnd}T00:00:00.000Z`) : null,
});

const TimelineUpdateSchema = TimelineWriteSchema;
const PricingUpdateSchema = z.object({ model: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/) }).passthrough();
const OptionsUpdateSchema = z.array(z.object({
  label: z.string().min(1),
  description: z.string(),
  priceDelta: z.object({ amountMinor: z.number().int(), currency: z.string().min(1) }),
  selected: z.boolean().optional(),
  selection: z.enum(["required", "optional", "preselected"]).default("optional"),
  groupName: z.string().min(1).optional(),
  groupMode: z.enum(["single", "multi"]).optional(),
}));
const OptionSelectionSchema = z.object({ optionIds: z.array(IdSchema), apply: z.boolean().optional() }).strict();
const SectionUpdateSchema = z.object({ value: z.unknown().optional(), content: z.unknown().optional() }).strict().refine((value) => (value.value === undefined) !== (value.content === undefined), "Exactly one of value or content is required.");
const ReviewSchema = z.object({ notes: z.string().max(4000).optional() }).strict();
const ContractCreateSchema = z.object({ proposalId: IdSchema, terms: z.string().min(1), billing: z.unknown() }).strict();
const ContractUpdateSchema = z.object({ terms: z.string().min(1).optional(), billing: z.unknown().optional() }).strict();

type SignedContractEntry = {
  id: string;
  contractId: string;
  label: string;
  percent: { toString(): string } | string;
  amountMinor: number;
  currency: string;
  dueOn: Date | null;
  trigger: string;
  milestoneId?: string | null;
  invoiceId: string | null;
};

type SignedContractRecord = {
  id: string;
  proposalId: string;
  organizationId: string;
  status: string;
  terms: string;
  billing: unknown;
  signedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  entries: SignedContractEntry[];
};

const orderedEntries = <T extends { id: string }>(billing: unknown, entries: T[]): T[] => {
  if (!billing || typeof billing !== "object" || Array.isArray(billing)) return entries;
  const snapshotEntries = (billing as { entries?: unknown }).entries;
  if (!Array.isArray(snapshotEntries)) return entries;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ordered: T[] = [];
  for (const snapshot of snapshotEntries) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return entries;
    const id = (snapshot as { id?: unknown }).id;
    if (typeof id !== "string") return entries;
    const entry = byId.get(id);
    if (!entry) return entries;
    ordered.push(entry);
  }
  return ordered.length === entries.length ? ordered : entries;
};

const presentSignedContract = (contract: SignedContractRecord) => ({
  id: contract.id,
  proposalId: contract.proposalId,
  organizationId: contract.organizationId,
  status: contract.status,
  terms: contract.terms,
  billing: contract.billing,
  signedAt: contract.signedAt,
  createdAt: contract.createdAt,
  updatedAt: contract.updatedAt,
  entries: orderedEntries(contract.billing, contract.entries).map((entry) => ({
    id: entry.id,
    contractId: entry.contractId,
    label: entry.label,
    percent: formatBillingPercent(typeof entry.percent === "string" ? entry.percent : entry.percent.toString()),
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    dueOn: entry.dueOn,
    trigger: entry.trigger,
    milestoneId: entry.milestoneId ?? null,
    invoiceId: entry.invoiceId,
  })),
});

const scheduleSnapshot = (entries: SignedContractEntry[], total: { amountMinor: number; currency: string }) => ({
  total,
  entries: entries.map((entry) => ({
    id: entry.id,
    label: entry.label,
    percent: formatBillingPercent(typeof entry.percent === "string" ? entry.percent : entry.percent.toString()),
    amount: { amountMinor: entry.amountMinor, currency: entry.currency },
    dueOn: null,
    trigger: entry.trigger,
    milestoneId: entry.milestoneId ?? null,
    invoiceId: entry.invoiceId,
  })),
});


const upfrontInvoiceId = (entries: Array<{ trigger: string; invoiceId: string | null }>): string | null => {
  const ids = [...new Set(entries.filter((entry) => entry.trigger === "contract_signed" && entry.invoiceId).map((entry) => entry.invoiceId))];
  return ids.length === 1 ? ids[0] ?? null : null;
};

const publicProposalDocument = (proposal: ProposalWithRelations) => {
  const document = proposalDocument(proposal);
  const { id: _id, organizationId: _organizationId, ownerId: _ownerId, ...publicDocument } = document;
  return publicDocument;
};

const money = (amountMinor: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format((amountMinor || 0) / 100);

const pricingText = (pricing: unknown): string => {
  const obj = jsonObject(pricing);
  const model = typeof obj.model === "string" ? obj.model : "";
  const currency = typeof obj.currency === "string" ? obj.currency : "USD";
  if (model === "hourly") return `${money(typeof obj.rateMinor === "number" ? obj.rateMinor : 0, currency)}/hour`;
  return money(typeof obj.amountMinor === "number" ? obj.amountMinor : 0, currency);
};

const proposalPdfModelFrom = (proposal: ProposalWithRelations, sections: Array<{ key: string; title: string; clientLabel: string; body: unknown }>, build: string, audit: ProposalPdfModel["audit"], organizationName: string | null): ProposalPdfModel => {
  const doc = proposalDocument(proposal);
  const nodes = sections.map((node) => {
    const body = node.body && typeof node.body === "object" && !Array.isArray(node.body) ? node.body as Record<string, unknown> : {};
    return {
      key: node.key,
      title: node.title,
      clientLabel: node.clientLabel,
      text: typeof body.text === "string" ? body.text : null,
    };
  });
  return {
    kind: "proposal",
    title: doc.title,
    engagement: doc.engagement,
    status: doc.status,
    version: doc.version ?? null,
    // ISO; the template prints it as "Nov 16, 2026".
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    build,
    organizationName,
    scope: doc.scope,
    timeline: { startDate: doc.timeline.startDate, targetDate: doc.timeline.targetDate, milestones: doc.timeline.milestones.map((m) => ({ title: m.title, dueDate: m.dueDate, description: m.description, weeksLow: m.weeksLow ?? null, weeksHigh: m.weeksHigh ?? null, hoursLow: m.hoursLow ?? null, hoursHigh: m.hoursHigh ?? null, endsWeekLow: m.endsWeekLow ?? null, endsWeekHigh: m.endsWeekHigh ?? null, gate: m.gate ?? "", actualStart: m.actualStart ?? null, actualEnd: m.actualEnd ?? null })) },
    pricingText: pricingText(doc.pricing),
    options: doc.options.map((o) => ({
      label: o.label,
      description: o.description,
      selected: o.selected,
      priceDeltaText: money(o.priceDelta.amountMinor, o.priceDelta.currency),
      selection: (o as { selection?: string | null }).selection ?? null,
      groupName: (o as { groupName?: string | null }).groupName ?? null,
    })),
    sections: nodes,
    audit,
  };
};

const contractPdfModelFrom = (contract: SignedContractRecord & { proposal: { title: string }; organization?: { name: string } | null }, build: string): ContractPdfModel => {
  const entries = orderedEntries(contract.billing, contract.entries);
  const snapshot = jsonObject(contract.billing);
  const totalObj = jsonObject(snapshot.total);
  const totalMinor = typeof totalObj.amountMinor === "number" ? totalObj.amountMinor : entries.reduce((sum, e) => sum + (e.amountMinor || 0), 0);
  const currency = typeof totalObj.currency === "string" ? totalObj.currency : entries[0]?.currency ?? "USD";
  return {
    kind: "contract",
    contractId: contract.id,
    proposalTitle: contract.proposal.title,
    organizationName: contract.organization?.name ?? contract.organizationId,
    status: contract.status,
    createdAt: contract.createdAt.toISOString().slice(0, 10),
    updatedAt: contract.updatedAt.toISOString().slice(0, 10),
    signedAt: contract.signedAt ? contract.signedAt.toISOString().slice(0, 10) : null,
    termsTitle: contract.terms,
    termsBody: contract.terms,
    billing: {
      totalText: money(totalMinor, currency),
      entries: entries.map((e) => ({ label: e.label, percent: formatBillingPercent(typeof e.percent === "string" ? e.percent : e.percent.toString()), amountText: money(e.amountMinor, e.currency), trigger: e.trigger, invoiceId: e.invoiceId })),
    },
    build,
    audit: { note: `contractId=${contract.id} organizationId=${contract.organizationId} proposalId=${contract.proposalId}` },
  };
};

export function createProposalContractRouter({ prisma, authorize = defaultAuthorize(prisma) }: ProposalContractRouterOptions): Router {
  const router = Router();
  const auth = (request: Request, scope: string, staff = false) => authorize(request, { scope, staff });

  router.post("/proposals/:id/public-link", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const token = randomBytes(32).toString("base64url");
    await prisma.proposalPublicLink.create({ data: { proposalId: proposal.id, tokenHash: publicTokenHash(token), expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    ok(request, response, { token, path: `/proposal/${token}`, apiPath: `/api/v1/public/proposals/${token}` }, true, 201);
  }));

  router.delete("/proposals/:id/public-link", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    await prisma.proposalPublicLink.updateMany({ where: { proposalId: proposal.id, revokedAt: null }, data: { revokedAt: new Date() } });
    ok(request, response, { revoked: true }, true);
  }));

  router.get("/public/proposals/:token", run(async (request, response) => {
    const link = await prisma.proposalPublicLink.findFirst({ where: { tokenHash: publicTokenHash(pathParam(request, "token")), revokedAt: null, expiresAt: { gt: new Date() } }, include: { proposal: { include: proposalInclude } } });
    if (!link || link.proposal.status === "draft") throw new RouteError(404, "NOT_FOUND", "The public proposal was not found.");
    ok(request, response, { proposal: publicProposalDocument(link.proposal), interaction: { chat: `/api/v1/public/proposals/${pathParam(request, "token")}/chat` } });
  }));


  router.put("/proposals/:id/sections/:sectionId", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(SectionUpdateSchema, request.body);
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    await guardCommercialEdit(prisma, current.id, principal);
    const scope = { ...jsonObject(current.scope), [pathParam(request, "sectionId")]: input.value ?? input.content };
    const updated = await prisma.proposal.update({ where: { id: current.id }, data: { scope: prismaJson(scope), version: { increment: 1 } }, include: proposalInclude });
    await recordCommercialEdit(prisma, current.id, principal);
    ok(request, response, proposalDocument(updated), true);
  }));

  router.put("/proposals/:id/timeline", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(TimelineUpdateSchema, request.body);
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    const planned = await planTimelineWrite(prisma, current.id, jsonObject(current.timeline), current.milestones, input);
    const timeline = planned.timeline;
    const updated = await prisma.$transaction(async (tx) => {
      if (planned.rows) {
        await tx.timelineMilestone.deleteMany({ where: { proposalId: current.id } });
        if (planned.rows.length) {
          await tx.timelineMilestone.createMany({ data: planned.rows.map((milestone) => ({ proposalId: current.id, ...milestoneTableRow(milestone) })) });
        }
      }
      return tx.proposal.update({ where: { id: current.id }, data: { timeline: prismaJson(timeline), version: { increment: 1 } }, include: proposalInclude });
    });
    await markWrittenParts(prisma, current.id, writtenKeysForPatch({ timeline }));
    ok(request, response, proposalDocument(updated), true, 200, {}, planned.warnings);
  }));

  router.post("/proposals/:id/phase-estimates", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(PhaseEstimateSchema, request.body);
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    const phases = input.total
      ? splitEngagementRange(input.total, input.phases.length).map((estimate, index) => ({ milestoneId: input.phases[index]!.milestoneId, ...estimate }))
      : input.phases.map((phase) => ({ milestoneId: phase.milestoneId, hoursLow: phase.hoursLow!, hoursHigh: phase.hoursHigh!, weeksLow: phase.weeksLow!, weeksHigh: phase.weeksHigh! }));
    const known = new Set(current.milestones.map((milestone) => milestone.id));
    const missing = phases.filter((phase) => !known.has(phase.milestoneId)).map((phase) => phase.milestoneId);
    if (missing.length) throw new RouteError(404, "NOT_FOUND", "A phase estimate names a milestone that is not on this proposal.", missing.map((milestoneId) => ({ path: "phases", code: "unknown_milestone", message: "A phase estimate names a milestone that is not on this proposal.", milestoneId })));
    const timeline = jsonObject(current.timeline);
    const milestones = Array.isArray(timeline.milestones) ? timeline.milestones.map((item) => (item && typeof item === "object" ? { ...item } : item)) : [];
    for (const phase of phases) {
      await prisma.timelineMilestone.update({
        where: { id: phase.milestoneId },
        data: { hoursLow: phase.hoursLow, hoursHigh: phase.hoursHigh, weeksLow: phase.weeksLow, weeksHigh: phase.weeksHigh },
      });
      const stored = milestones.find((item) => item && typeof item === "object" && (item as { id?: string }).id === phase.milestoneId) as Record<string, unknown> | undefined;
      if (stored) Object.assign(stored, { hoursLow: phase.hoursLow, hoursHigh: phase.hoursHigh, weeksLow: phase.weeksLow, weeksHigh: phase.weeksHigh });
    }
    await prisma.proposal.update({ where: { id: current.id }, data: { timeline: prismaJson({ ...timeline, milestones }) } });
    const fresh = await prisma.proposal.findFirstOrThrow({ where: { id: current.id }, include: proposalInclude });
    ok(request, response, { kind: "estimate", phases, total: input.total ?? null, proposal: proposalDocument(fresh) }, true);
  }));

  router.get("/proposals/:id/roles", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const roles = await prisma.proposalRole.findMany({ where: { proposalId: proposal.id }, include: { phases: true }, orderBy: { sortOrder: "asc" } });
    ok(request, response, { roles: roles.map(roleView) });
  }));

  router.put("/proposals/:id/roles", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(RolesReplaceSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const phases = await prisma.timelineMilestone.findMany({ where: { proposalId: proposal.id }, select: { id: true } });
    const phaseIds = new Set(phases.map((phase) => phase.id));
    const planned = input.roles.map((role, index) => {
      const parsed = parseHeaviest(role.heaviestIn, phaseIds);
      if ("error" in parsed) throw new RouteError(400, "VALIDATION_FAILED", parsed.error);
      return { ...role, sortOrder: (index + 1) * 10, heaviestAll: parsed.heaviestAll, heaviestGates: parsed.heaviestGates, phaseIds: parsed.phaseIds };
    });
    const saved = await prisma.$transaction(async (tx) => {
      await tx.proposalRole.deleteMany({ where: { proposalId: proposal.id } });
      const created = [];
      for (const role of planned) {
        const row = await tx.proposalRole.create({
          data: {
            proposalId: proposal.id,
            sortOrder: role.sortOrder,
            name: role.name,
            side: role.side,
            responsibility: role.responsibility,
            heaviestAll: role.heaviestAll,
            heaviestGates: role.heaviestGates,
            phases: { create: role.phaseIds.map((milestoneId) => ({ milestoneId })) },
          },
          include: { phases: true },
        });
        created.push(row);
      }
      return created;
    });
    ok(request, response, { roles: saved.map(roleView) }, true);
  }));

  router.put("/proposals/:id/budget", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    parse(PricingUpdateSchema, request.body);
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    const catalog = await loadActiveCatalog(prisma);
    let input;
    try { input = parseCatalogPricing(catalog, current.engagement, request.body); }
    catch (error) {
      if (error instanceof BillingScheduleError) throw new RouteError(400, "VALIDATION_FAILED", error.message);
      throw error;
    }
    await guardCommercialEdit(prisma, current.id, principal);
    const updated = await prisma.proposal.update({ where: { id: current.id }, data: { pricingModel: input.model, pricing: prismaJson(input), catalogVersionId: catalog.id, version: { increment: 1 } }, include: proposalInclude });
    await recordCommercialEdit(prisma, current.id, principal);
    ok(request, response, proposalDocument(updated), true);
  }));

  router.put("/proposals/:id/options", run(async (request, response) => {
    const principal = await auth(request, "proposals:write", true);
    const input = parse(OptionsUpdateSchema, request.body);
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    await guardCommercialEdit(prisma, current.id, principal);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.proposalOption.deleteMany({ where: { proposalId: current.id } });
      await tx.proposalOptionGroup.deleteMany({ where: { proposalId: current.id } });
      const groupIds = new Map<string, string>();
      for (const option of input) {
        if (!option.groupName || groupIds.has(option.groupName)) continue;
        const created = await tx.proposalOptionGroup.create({ data: { proposalId: current.id, name: option.groupName, mode: option.groupMode ?? "single" } });
        groupIds.set(option.groupName, created.id);
      }
      if (input.length) {
        await tx.proposalOption.createMany({
          data: input.map((option) => ({
            proposalId: current.id,
            label: option.label,
            description: option.description,
            priceDeltaMinor: option.priceDelta.amountMinor,
            priceCurrency: option.priceDelta.currency,
            selected: option.selection === "required" || option.selection === "preselected" || option.selected === true,
            selection: option.selection,
            groupId: option.groupName ? groupIds.get(option.groupName) ?? null : null,
          })),
        });
      }
      return tx.proposal.findUniqueOrThrow({ where: { id: current.id }, include: proposalInclude });
    });
    await recordCommercialEdit(prisma, current.id, principal);
    ok(request, response, proposalDocument(updated), true);
  }));

  router.post("/proposals/:id/options/selection", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const raw = jsonObject(request.body);
    if ("priceDelta" in raw || "amountMinor" in raw || "pricing" in raw) throw new RouteError(403, "FORBIDDEN", "Prices are set by staff. Choose among the options they created.");
    const input = parse(OptionSelectionSchema, request.body ?? {});
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    // Every id must be an option on this proposal; a made-up or foreign id used to be ignored and reported as a change.
    const known = new Set(current.options.map((option) => option.id));
    const unknown = input.optionIds.filter((optionId) => !known.has(optionId));
    if (unknown.length) {
      if (!current.options.length) {
        // Template packages are suggestions without prices; they become selectable options only after staff price them.
        const template = await prisma.proposalTemplateOption.findMany({ where: { templateCode: current.templateCode }, orderBy: { sortOrder: "asc" } });
        throw new RouteError(409, "NO_PRICED_OPTIONS", template.length
          ? `This proposal has no priced options yet. The ${current.templateCode} template suggests ${template.map((option) => option.label).join(", ")}, but staff must price them before they can be selected.`
          : "This proposal has no options to select.", [{ path: "optionIds", code: "no_priced_options", message: "No priced options exist on this proposal.", unknownOptionIds: unknown, templateOptions: template.map((option) => ({ code: option.code, label: option.label })) }]);
      }
      throw new RouteError(400, "VALIDATION_FAILED", `These option ids are not options on this proposal: ${unknown.join(", ")}.`, unknown.map((optionId) => ({ path: "optionIds", code: "unknown_option", message: `Option ${optionId} is not on this proposal.`, optionId })));
    }
    const version = current.approvedVersionId ? await prisma.proposalVersion.findUnique({ where: { id: current.approvedVersionId } }) : null;
    const locked = Boolean(version?.locked);
    const store = prismaCompletionStore(prisma);
    if (locked && !input.apply) {
      await store.ensure(current.id);
      const nodes = await store.nodes(current.id);
      const nodeKey = nodes.some((node) => node.key === "options") ? "options" : "price";
      const preview = await previewChange(store, current.id, nodeKey, "option selection");
      ok(request, response, { needsImpact: true, preview, totalMinor: quotedTotal(current), options: proposalDocument(current).options });
      return;
    }
    if (locked && input.apply) {
      await store.ensure(current.id);
      const nodes = await store.nodes(current.id);
      const nodeKey = nodes.some((node) => node.key === "options") ? "options" : "price";
      await applyChange(store, current.id, nodeKey, "option selection", principal.userId);
    }
    const next = applyOptionSelection(
      current.options.map((option) => ({ id: option.id, selection: option.selection, groupId: option.groupId, priceDeltaMinor: option.priceDeltaMinor, selected: option.selected })),
      current.optionGroups.map((group) => ({ id: group.id, mode: group.mode })),
      input.optionIds,
    );
    const before = new Map(current.options.map((option) => [option.id, option.selected]));
    const changedOptions = next.filter((option) => before.get(option.id) !== option.selected);
    if (changedOptions.length) {
      await prisma.$transaction(async (tx) => {
        for (const option of changedOptions) await tx.proposalOption.update({ where: { id: option.id }, data: { selected: option.selected } });
      });
    }
    const updated = await prisma.proposal.findUniqueOrThrow({ where: { id: current.id }, include: proposalInclude });
    ok(request, response, { needsImpact: false, totalMinor: quotedTotal(updated), options: proposalDocument(updated).options }, changedOptions.length > 0);
  }));

  router.post("/proposals/:id/review", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(ReviewSchema, request.body ?? {});
    const current = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    // Same path as unw_submit_proposal_for_review: draft -> agent_review through the review policy, which also sets Proposal.status from record_status.
    if (current.reviewState !== "draft") throw new RouteError(409, "CONFLICT", "This proposal is already in review.");
    if (input.notes !== undefined) await prisma.proposal.update({ where: { id: current.id }, data: { scope: prismaJson({ ...jsonObject(current.scope), reviewNotes: input.notes }) } });
    await applyTransition(prismaReviewStore(prisma), { proposalId: current.id, actorId: principal.userId, actorRole: "agent", toStatus: "agent_review" });
    await stopTickler(prisma, current.id, "submitted");
    await noteGuidanceAction(prisma, { proposalId: current.id, sessionId: guidanceSessionId(request, principal.userId, current.id), actionTaken: "submitted", explicitTrigger: "submit_attempt" });
    const updated = await prisma.proposal.findUniqueOrThrow({ where: { id: current.id }, include: proposalInclude });
    ok(request, response, proposalDocument(updated), true);
  }));

  router.get("/proposals/:id/export", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    const build = process.env.UNWH_VERSION ?? "unknown";
    response.setHeader("x-unwhelm-build", build);
    // format used to be ignored: every call returned the JSON document without narrative, parked items, or a PDF.
    const format = parseExportFormat(request.query.format);
    if (!format) throw new RouteError(400, "VALIDATION_FAILED", `Unsupported export format "${String(request.query.format)}". Use one of: ${EXPORT_FORMATS.join(", ")}.`, [{ path: "format", code: "invalid_value", message: `Use one of: ${EXPORT_FORMATS.join(", ")}.`, allowed: [...EXPORT_FORMATS] }]);
    const document = proposalDocument(proposal);
    const extras = await exportExtras(prisma, proposal.id);
    const portal = proposalPortalUrl(proposal.id);
    const pdfPath = `/api/v1/proposals/${proposal.id}/pdf`;
    const links = { portal, pdf: `${webPublicUrl()}${pdfPath}` };
    if (format === "markdown") {
      ok(request, response, { format, proposalId: proposal.id, title: proposal.title, contentType: "text/markdown", markdown: proposalMarkdown(document, extras, portal), build }, false, 200, links);
      return;
    }
    if (format === "pdf") {
      // The PDF is binary, so the envelope points at the signed-in download instead of inlining it.
      ok(request, response, { format, proposalId: proposal.id, title: proposal.title, contentType: "application/pdf", downloadPath: pdfPath, url: links.pdf, build }, false, 200, links);
      return;
    }
    ok(request, response, { ...document, format, narrative: extras.narrative, parked: extras.parked, build }, false, 200, links);
  }));

  router.get("/proposals/:id/redline", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const from = Number(request.query.from);
    const to = Number(request.query.to);
    if (!Number.isInteger(from) || !Number.isInteger(to)) throw new RouteError(400, "VALIDATION_FAILED", "Query from and to must be version numbers.");
    const versions = await prisma.proposalVersion.findMany({ where: { proposalId: proposal.id, number: { in: [from, to] } } });
    const earlier = versions.find((item) => item.number === from);
    const later = versions.find((item) => item.number === to);
    if (!earlier || !later) throw new RouteError(404, "NOT_FOUND", "Those proposal versions were not found.");
    const bytes = redlineDocx(snapshotText(earlier.snapshot), snapshotText(later.snapshot));
    response.setHeader("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    response.setHeader("content-disposition", `attachment; filename="proposal-${proposal.id}-redline.docx"`);
    response.status(200).send(bytes);
  }));

  router.get("/proposals/:id/pdf", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal), include: proposalInclude });
    const build = process.env.UNWH_VERSION ?? "unknown";
    const org = proposal.organizationId ? await prisma.organization.findUnique({ where: { id: proposal.organizationId } }) : null;

    // Prefer the locked approved snapshot when present, so the export is stable after acceptance.
    let audit: ProposalPdfModel["audit"] = { source: "live_proposal", approvedVersionId: proposal.approvedVersionId ?? null };
    let sourceProposal = proposal;
    if (proposal.approvedVersionId) {
      const version = await prisma.proposalVersion.findUnique({ where: { id: proposal.approvedVersionId } });
      const snapshot = version?.snapshot;
      const snap = jsonObject(snapshot);
      if (version?.locked && snap && typeof snap === "object") {
        audit = { source: "approved_version_snapshot", approvedVersionId: proposal.approvedVersionId, approvedVersionNumber: version.number };
        sourceProposal = {
          ...proposal,
          title: typeof snap.title === "string" ? snap.title : proposal.title,
          engagement: typeof snap.engagement === "string" ? snap.engagement : proposal.engagement,
          status: typeof snap.status === "string" ? snap.status : proposal.status,
          scope: (snap.scope ?? proposal.scope) as never,
          timeline: (snap.timeline ?? proposal.timeline) as never,
          pricing: (snap.pricing ?? proposal.pricing) as never,
          version: typeof snap.version === "number" ? snap.version : proposal.version,
          createdAt: proposal.createdAt,
          updatedAt: proposal.updatedAt,
        } as typeof proposal;
      }
    }

    const sections = await prisma.proposalNode.findMany({
      where: { proposalId: proposal.id, kind: "section" },
      orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
      select: { key: true, title: true, clientLabel: true, body: true },
    });

    const model = proposalPdfModelFrom(sourceProposal, sections, build, audit, org?.name ?? null);
    const html = proposalPdfHtml(model);
    let pdf: Buffer;
    try {
      pdf = await renderPdf({
        html,
        title: `Proposal — ${model.title}`,
        // No running header (it printed over the branded cover); the build stays in the short audit line at the end.
        footerText: "Prepared by Unwhelm",
      });
    } catch (error) {
      if (error instanceof PdfRenderError) throw new RouteError(503, "PDF_UNAVAILABLE", error.message);
      throw error;
    }
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `attachment; filename="unwhelm-proposal-${proposal.id.slice(0, 8)}.pdf"`);
    response.setHeader("x-unwhelm-build", build);
    response.status(200).send(pdf);
  }));

  router.get("/proposals/:id/attachments", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const rows = await prisma.proposalAttachment.findMany({
      where: { proposalId: proposal.id },
      select: attachmentMetadataSelect,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    ok(request, response, { items: rows.map((row) => attachmentView(row as AttachmentRecord)) });
  }));

  router.put("/proposals/:id/attachments/order", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(AttachmentOrderSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const existing = await prisma.proposalAttachment.findMany({ where: { proposalId: proposal.id }, select: { id: true } });
    const currentIds = existing.map((row) => row.id);
    if (!sameIdSet(currentIds, input.ids)) throw new RouteError(400, "VALIDATION_FAILED", "ids must list every attachment on this proposal exactly once.");
    await prisma.$transaction(input.ids.map((id, index) => prisma.proposalAttachment.update({ where: { id }, data: { sortOrder: index } })));
    const rows = await prisma.proposalAttachment.findMany({
      where: { proposalId: proposal.id },
      select: attachmentMetadataSelect,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    ok(request, response, { items: rows.map((row) => attachmentView(row as AttachmentRecord)) }, true);
  }));

  router.post("/proposals/:id/attachments", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(AttachmentWriteSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const payload = parseAttachmentPayload(input.filename, input.contentBase64);
    const duplicate = await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } });
    if (duplicate) throw new RouteError(409, "CONFLICT", "A document with that filename already exists on this proposal.");
    const max = await prisma.proposalAttachment.aggregate({ where: { proposalId: proposal.id }, _max: { sortOrder: true } });
    const created = await prisma.proposalAttachment.create({
      data: {
        proposalId: proposal.id,
        filename: payload.filename,
        contentType: payload.contentType,
        byteSize: payload.byteSize,
        sha256: payload.sha256,
        bytes: new Uint8Array(payload.bytes),
        uploadedById: principal.userId,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
      select: attachmentMetadataSelect,
    });
    ok(request, response, attachmentView(created as AttachmentRecord), true, 201);
  }));

  router.post("/proposals/:id/attachments/link", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(z.object({ filename: z.string().min(1).max(200), sourceUrl: z.string().min(1).max(2000) }).strict(), request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const payload = parseLinkedDocument(input.filename, input.sourceUrl);
    const duplicate = await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } });
    if (duplicate) throw new RouteError(409, "CONFLICT", "A document with that filename already exists on this proposal.");
    const max = await prisma.proposalAttachment.aggregate({ where: { proposalId: proposal.id }, _max: { sortOrder: true } });
    const created = await prisma.proposalAttachment.create({
      data: {
        proposalId: proposal.id,
        filename: payload.filename,
        contentType: payload.contentType,
        byteSize: 0,
        sha256: payload.sha256,
        bytes: new Uint8Array(),
        sourceUrl: payload.sourceUrl,
        uploadedById: principal.userId,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
      select: attachmentMetadataSelect,
    });
    ok(request, response, attachmentView(created as AttachmentRecord), true, 201);
  }));

  router.post("/proposals/:id/attachments/fetch", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(z.object({ filename: z.string().min(1).max(200), sourceUrl: z.string().min(1).max(2000) }).strict(), request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const linked = parseLinkedDocument(input.filename, input.sourceUrl);
    const addresses = await lookup(new URL(linked.sourceUrl).hostname, { all: true });
    if (addresses.some((entry) => blockedAddress(entry.address))) throw new RouteError(400, "VALIDATION_FAILED", "The document link must be a public https URL.");
    const fetched = await fetch(linked.sourceUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (fetched.status >= 300 && fetched.status < 400) throw new RouteError(400, "VALIDATION_FAILED", "The document link must not redirect.");
    if (!fetched.ok) throw new RouteError(400, "VALIDATION_FAILED", "The document link did not return the file.");
    const payload = validateAttachmentBytes(linked.filename, Buffer.from(await fetched.arrayBuffer()));
    const duplicate = await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } });
    if (duplicate) throw new RouteError(409, "CONFLICT", "A document with that filename already exists on this proposal.");
    const max = await prisma.proposalAttachment.aggregate({ where: { proposalId: proposal.id }, _max: { sortOrder: true } });
    const created = await prisma.proposalAttachment.create({
      data: {
        proposalId: proposal.id, filename: payload.filename, contentType: payload.contentType, byteSize: payload.byteSize, sha256: payload.sha256,
        bytes: new Uint8Array(payload.bytes), sourceUrl: linked.sourceUrl, uploadedById: principal.userId, sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
      select: attachmentMetadataSelect,
    });
    ok(request, response, attachmentView(created as AttachmentRecord), true, 201);
  }));

  router.post("/proposals/:id/attachments/parts", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(z.object({ filename: z.string().min(1).max(200), partIndex: z.number().int().min(0).max(1999), partCount: z.number().int().min(1).max(2000), contentBase64: z.string().min(1) }).strict().refine((value) => value.partIndex < value.partCount, "partIndex must be less than partCount."), request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const part = parseUploadPart(input.filename, input.contentBase64);
    await prisma.proposalUploadPart.upsert({
      where: { proposalId_filename_partIndex: { proposalId: proposal.id, filename: part.filename, partIndex: input.partIndex } },
      create: { proposalId: proposal.id, filename: part.filename, partIndex: input.partIndex, partCount: input.partCount, bytes: new Uint8Array(part.bytes) },
      update: { partCount: input.partCount, bytes: new Uint8Array(part.bytes) },
    });
    const stored = await prisma.proposalUploadPart.findMany({ where: { proposalId: proposal.id, filename: part.filename }, orderBy: { partIndex: "asc" } });
    if (stored.length < input.partCount || stored.some((row) => row.partCount !== input.partCount)) {
      ok(request, response, { filename: part.filename, received: stored.length, partCount: input.partCount, complete: false }, true);
      return;
    }
    const payload = validateAttachmentBytes(part.filename, Buffer.concat(stored.map((row) => Buffer.from(row.bytes))));
    const duplicate = await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } });
    if (duplicate) throw new RouteError(409, "CONFLICT", "A document with that filename already exists on this proposal.");
    const max = await prisma.proposalAttachment.aggregate({ where: { proposalId: proposal.id }, _max: { sortOrder: true } });
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.proposalAttachment.create({
        data: {
          proposalId: proposal.id, filename: payload.filename, contentType: payload.contentType, byteSize: payload.byteSize, sha256: payload.sha256,
          bytes: new Uint8Array(payload.bytes), uploadedById: principal.userId, sortOrder: (max._max.sortOrder ?? -1) + 1,
        },
        select: attachmentMetadataSelect,
      });
      await tx.proposalUploadPart.deleteMany({ where: { proposalId: proposal.id, filename: part.filename } });
      return row;
    });
    ok(request, response, { ...attachmentView(created as AttachmentRecord), complete: true }, true, 201);
  }));

  router.put("/proposals/:id/attachments", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(AttachmentWriteSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const payload = parseAttachmentPayload(input.filename, input.contentBase64);
    const existing = await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } });
    if (existing) {
      const updated = await prisma.proposalAttachment.update({
        where: { id: existing.id },
        data: {
          contentType: payload.contentType,
          byteSize: payload.byteSize,
          sha256: payload.sha256,
          bytes: new Uint8Array(payload.bytes),
          uploadedById: principal.userId,
        },
        select: attachmentMetadataSelect,
      });
      ok(request, response, attachmentView(updated as AttachmentRecord), true);
      return;
    }
    const max = await prisma.proposalAttachment.aggregate({ where: { proposalId: proposal.id }, _max: { sortOrder: true } });
    const created = await prisma.proposalAttachment.create({
      data: {
        proposalId: proposal.id,
        filename: payload.filename,
        contentType: payload.contentType,
        byteSize: payload.byteSize,
        sha256: payload.sha256,
        bytes: new Uint8Array(payload.bytes),
        uploadedById: principal.userId,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
      select: attachmentMetadataSelect,
    });
    ok(request, response, attachmentView(created as AttachmentRecord), true, 201);
  }));

  router.get("/proposals/:id/attachments/:attachmentId", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const row = await prisma.proposalAttachment.findFirst({ where: { id: pathParam(request, "attachmentId"), proposalId: proposal.id } });
    if (!row) throw new RouteError(404, "NOT_FOUND", "The requested document was not found.");
    if (row.sourceUrl) {
      response.redirect(302, row.sourceUrl);
      return;
    }
    response.setHeader("content-type", row.contentType);
    response.setHeader("content-disposition", `inline; filename="${row.filename.replaceAll('"', "")}"`);
    response.status(200).send(Buffer.from(row.bytes));
  }));

  router.put("/proposals/:id/attachments/:attachmentId", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const input = parse(AttachmentReplaceSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const current = await prisma.proposalAttachment.findFirst({ where: { id: pathParam(request, "attachmentId"), proposalId: proposal.id } });
    if (!current) throw new RouteError(404, "NOT_FOUND", "The requested document was not found.");
    const payload = parseAttachmentPayload(input.filename ?? current.filename, input.contentBase64);
    const clash = payload.filename !== current.filename
      ? await prisma.proposalAttachment.findFirst({ where: { proposalId: proposal.id, filename: payload.filename } })
      : null;
    if (clash) throw new RouteError(409, "CONFLICT", "A document with that filename already exists on this proposal.");
    const updated = await prisma.proposalAttachment.update({
      where: { id: current.id },
      data: {
        filename: payload.filename,
        contentType: payload.contentType,
        byteSize: payload.byteSize,
        sha256: payload.sha256,
        bytes: new Uint8Array(payload.bytes),
        uploadedById: principal.userId,
      },
      select: attachmentMetadataSelect,
    });
    ok(request, response, attachmentView(updated as AttachmentRecord), true);
  }));

  router.delete("/proposals/:id/attachments/:attachmentId", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const current = await prisma.proposalAttachment.findFirst({ where: { id: pathParam(request, "attachmentId"), proposalId: proposal.id } });
    if (!current) throw new RouteError(404, "NOT_FOUND", "The requested document was not found.");
    await prisma.proposalAttachment.delete({ where: { id: current.id } });
    ok(request, response, { deleted: true }, true);
  }));

  router.post("/proposals/import", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const document = parse(ProposalDocumentSchema, request.body?.document ?? request.body);
    const organizationId = principal.organizationId ?? document.organizationId;
    if (!organizationId) throw new RouteError(403, "FORBIDDEN", "An organization context is required to import a proposal.");
    const catalog = await loadActiveCatalog(prisma);
    let priced;
    try { priced = parseCatalogPricing(catalog, document.engagement, document.pricing); }
    catch (error) {
      if (error instanceof BillingScheduleError) throw new RouteError(400, "VALIDATION_FAILED", error.message);
      throw error;
    }
    const created = await prisma.proposal.create({ data: { organizationId, ownerId: principal.userId, title: document.title, engagement: document.engagement, status: document.status, scope: prismaJson(document.scope), timeline: prismaJson({ startDate: document.timeline.startDate, targetDate: document.timeline.targetDate }), pricingModel: priced.model, pricing: prismaJson(priced), catalogVersionId: catalog.id, options: { create: document.options.map(optionInput) }, milestones: { create: document.timeline.milestones.map(milestoneInput) } }, include: proposalInclude });
    ok(request, response, proposalDocument(created), true, 201);
  }));

  router.get("/proposals/:id/commitment-preview", run(async (request, response) => {
    await auth(request, "proposals:read");
    const catalog = await loadActiveCatalog(prisma);
    ok(request, response, await previewCommitment(prisma, catalog, pathParam(request, "id")));
  }));

  router.post("/proposals/:id/accept", run(async (request, response) => {
    const principal = await auth(request, "proposals:write");
    const organizationId = requireOrganization(principal);
    const body = jsonObject(request.body);
    const catalog = await loadActiveCatalog(prisma);
    const result = await acceptProposal(prisma, catalog, {
      proposalId: pathParam(request, "id"),
      organizationId,
      actorUserId: principal.userId,
      requestId: requestId(request),
      method: request.method,
      path: request.path,
      terms: typeof body.terms === "string" ? body.terms : undefined,
    });
    if (!result.idempotent) await noteGuidanceAction(prisma, { proposalId: pathParam(request, "id"), sessionId: guidanceSessionId(request, principal.userId, pathParam(request, "id")), actionTaken: "accepted" });
    const links: Record<string, string> = { contract: `/api/v1/contracts/${result.contract.id}` };
    if (result.invoice) links.invoice = `/api/v1/invoices/${result.invoice.id}`;
    ok(request, response, result, !result.idempotent, result.idempotent ? 200 : 201, links);
  }));

  router.get("/proposals/:id/acceptance", run(async (request, response) => {
    const principal = await auth(request, "proposals:read");
    const proposal = await prisma.proposal.findFirstOrThrow({ where: proposalWhere(pathParam(request, "id"), principal) });
    const versionId = proposal.approvedVersionId;
    const contract = versionId ? await prisma.contract.findFirst({ where: { proposalVersionId: versionId, organizationId: proposal.organizationId ?? undefined } }) : null;
    if (!contract) {
      ok(request, response, { proposalId: proposal.id, idempotent: true, contract: null, invoice: null });
      return;
    }
    const invoice = await prisma.invoice.findFirst({ where: { contractId: contract.id }, orderBy: { createdAt: "asc" } });
    ok(request, response, {
      proposalId: proposal.id,
      idempotent: true,
      contract: {
        id: contract.id,
        proposalId: contract.proposalId,
        proposalVersionId: contract.proposalVersionId,
        status: contract.status,
        terms: contract.terms,
        scope: contract.scope,
        pricing: contract.pricing,
        signedAt: contract.signedAt?.toISOString() ?? null,
      },
      invoice: invoice ? { id: invoice.id, amountMinor: invoice.amountMinor, currency: invoice.currency, dueDate: invoice.dueDate.toISOString(), status: invoice.status, creditAppliedMinor: 0 } : null,
    });
  }));

  router.get("/payment-terms", run(async (request, response) => {
    await auth(request, "billing:read");
    const items = await prisma.paymentTerm.findMany({ orderBy: { sortOrder: "asc" } });
    ok(request, response, { items });
  }));

  // Contract writes other than sign are staff-only. contracts:write on a client token does not pass this check.
  router.patch("/contracts/:id/billing-terms", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const body = jsonObject(request.body);
    const current = await prisma.contract.findFirstOrThrow({ where: { id: pathParam(request, "id"), organizationId: requireOrganization(principal) } });
    const data: Prisma.ContractUpdateInput = {};
    if (typeof body.paymentTermId === "string") {
      const term = await prisma.paymentTerm.findUnique({ where: { id: body.paymentTermId } });
      if (!term) throw new RouteError(400, "VALIDATION_FAILED", "That payment term is not configured.");
      data.paymentTerm = { connect: { id: term.id } };
    }
    if (typeof body.retainagePercentBasis === "number") {
      if (!Number.isInteger(body.retainagePercentBasis) || body.retainagePercentBasis < 0 || body.retainagePercentBasis > 1_000_000) {
        throw new RouteError(400, "VALIDATION_FAILED", "Retainage percent basis must be an integer from 0 to 1000000.");
      }
      data.retainagePercentBasis = body.retainagePercentBasis;
    }
    const updated = await prisma.contract.update({ where: { id: current.id }, data });
    ok(request, response, updated, true);
  }));

  router.post("/contracts/:id/retainage/release", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const catalog = await loadActiveCatalog(prisma);
    const result = await releaseRetainage(prisma, catalog, { contractId: pathParam(request, "id"), organizationId: requireOrganization(principal) });
    ok(request, response, result, !result.idempotent, result.idempotent ? 200 : 201, { invoice: `/api/v1/invoices/${result.invoice.id}` });
  }));

  router.get("/contracts", run(async (request, response) => {
    const principal = await auth(request, "contracts:read");
    const contracts = await prisma.contract.findMany({ where: principal.organizationId ? { organizationId: principal.organizationId } : { proposal: { ownerId: principal.userId } }, orderBy: { updatedAt: "desc" } });
    ok(request, response, { items: contracts, nextCursor: null, totalEstimate: contracts.length });
  }));

  router.post("/contracts", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const organizationId = requireOrganization(principal);
    const input = parse(ContractCreateSchema, request.body);
    const proposal = await prisma.proposal.findFirstOrThrow({ where: { id: input.proposalId, organizationId } });
    const contract = await prisma.contract.create({ data: { proposalId: proposal.id, organizationId, terms: input.terms, billing: prismaJson(input.billing) } });
    ok(request, response, contract, true, 201);
  }));

  router.get("/contracts/:id", run(async (request, response) => {
    const principal = await auth(request, "contracts:read");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id: pathParam(request, "id"), ...(principal.organizationId ? { organizationId: principal.organizationId } : { proposal: { ownerId: principal.userId } }) }, include: { entries: true } });
    ok(request, response, contract);
  }));

  router.get("/contracts/:id/pdf", run(async (request, response) => {
    const principal = await auth(request, "contracts:read");
    const id = pathParam(request, "id");
    const current = principal.role === "staff"
      ? await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) }, include: { entries: true, proposal: true, organization: true } })
      : await clientContractToSign(prisma, principal, id) as never;
    const contract = current as unknown as SignedContractRecord & { proposal: { title: string }; organization?: { name: string } | null };
    const build = process.env.UNWH_VERSION ?? "unknown";
    const model = contractPdfModelFrom(contract, build);
    const html = contractPdfHtml(model);
    let pdf: Buffer;
    try {
      pdf = await renderPdf({
        html,
        title: `Contract — ${model.termsTitle}`,
        headerText: `Unwhelm · Contract`,
        footerText: `Prepared by Unwhelm · Build ${build}`,
      });
    } catch (error) {
      if (error instanceof PdfRenderError) throw new RouteError(503, "PDF_UNAVAILABLE", error.message);
      throw error;
    }
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `attachment; filename="unwhelm-contract-${contract.id.slice(0, 8)}.pdf"`);
    response.setHeader("x-unwhelm-build", build);
    response.status(200).send(pdf);
  }));

  router.patch("/contracts/:id", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const input = parse(ContractUpdateSchema, request.body);
    const current = await prisma.contract.findFirstOrThrow({ where: { id: pathParam(request, "id"), organizationId: requireOrganization(principal) } });
    const updated = await prisma.contract.update({ where: { id: current.id }, data: { ...(input.terms === undefined ? {} : { terms: input.terms }), ...(input.billing === undefined ? {} : { billing: prismaJson(input.billing) }) } });
    ok(request, response, updated, true);
  }));

  router.post("/contracts/:id/sign", run(async (request, response) => {
    const header = request.header("authorization");
    const principal = header?.startsWith("Bearer ") ? await bearerContractSigner(prisma, request) : await auth(request, "contracts:write");
    const id = pathParam(request, "id");
    // Staff keep the organization filter (another org stays not found). A client may sign only as a party, and a miss is 403.
    const current = principal.role === "staff"
      ? await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) }, include: { entries: true, proposal: true } })
      : await clientContractToSign(prisma, principal, id);
    if (current.status === "cancelled") throw new RouteError(409, "CONFLICT", "A cancelled contract cannot be signed.");
    const result = await signContractHelper(prisma, current.id);
    const links: Record<string, string> = {};
    if (result.invoiceId) links.invoice = `/api/v1/invoices/${result.invoiceId}`;
    ok(request, response, presentSignedContract(result.contract as SignedContractRecord), result.changed, 200, links);
  }));

  router.post("/contracts/:id/esign/send", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const runtime = esignRuntime(prisma);
    if (!runtime) throw new RouteError(404, "NOT_FOUND", "External e-sign is not enabled.");
    const id = pathParam(request, "id");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) }, include: { entries: true, proposal: true, organization: true } });
    if (contract.status === "cancelled") throw new RouteError(409, "CONFLICT", "A cancelled contract cannot be sent for signature.");
    if (contract.status === "signed") throw new RouteError(409, "CONFLICT", "A signed contract cannot be sent for signature.");
    const proposalVersionId = (contract as { proposalVersionId?: string | null }).proposalVersionId ?? (contract.proposal as { approvedVersionId?: string | null }).approvedVersionId;
    if (!proposalVersionId) throw new RouteError(409, "CONFLICT", "The contract is not tied to a locked proposal version.");

    const membership = await prisma.membership.findFirst({ where: { organizationId: contract.organizationId, status: "active", role: "client" }, include: { user: true } });
    const user = membership?.user;
    if (!user) throw new RouteError(422, "SIGNER_MISSING", "No active client user exists to receive the signature request.");

    const build = process.env.UNWH_VERSION ?? "unknown";
    const model = contractPdfModelFrom(contract as never, build);
    const html = contractPdfHtml(model);
    let pdf: Buffer;
    try {
      pdf = await renderPdf({
        html,
        title: `Contract — ${model.termsTitle}`,
        headerText: `Unwhelm · Contract`,
        footerText: `Prepared by Unwhelm · Build ${build}`,
      });
    } catch (error) {
      if (error instanceof PdfRenderError) throw new RouteError(503, "PDF_UNAVAILABLE", error.message);
      throw error;
    }

    const sent = await sendContractForEsign(
      { prisma, adapter: runtime.adapter, provider: runtime.provider, testMode: runtime.testMode, baseUrl: runtime.baseUrl },
      {
        contractId: contract.id,
        proposalVersionId,
        contractTitle: contract.terms,
        pdf,
        signer: { name: user.displayName, email: user.email },
      },
    );
    ok(request, response, { ...sent, provider: runtime.provider, testMode: runtime.testMode }, !sent.idempotent, sent.idempotent ? 200 : 201);
  }));

  router.get("/contracts/:id/esign/status", run(async (request, response) => {
    const principal = await auth(request, "contracts:read", true);
    const runtime = esignRuntime(prisma);
    if (!runtime) throw new RouteError(404, "NOT_FOUND", "External e-sign is not enabled.");
    const id = pathParam(request, "id");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) } });
    const proposalVersionId = (contract as { proposalVersionId?: string | null }).proposalVersionId ?? null;
    if (!proposalVersionId) { ok(request, response, { enabled: true, provider: runtime.provider, request: null }); return; }
    const requestRow = await prisma.contractEsignRequest.findFirst({ where: { contractId: contract.id, proposalVersionId } });
    if (!requestRow) { ok(request, response, { enabled: true, provider: runtime.provider, request: null }); return; }
    let provider = null;
    try {
      const status = await runtime.adapter.getStatus(requestRow.providerDocumentId);
      provider = { ...status, providerStatus: redactProviderStatus(status.providerStatus) };
    }
    catch { provider = null; }
    ok(request, response, {
      enabled: true,
      provider: runtime.provider,
      testMode: runtime.testMode,
      request: { id: requestRow.id, status: requestRow.status, providerDocumentId: requestRow.providerDocumentId, updatedAt: requestRow.updatedAt.toISOString(), completedAt: requestRow.completedAt?.toISOString() ?? null },
      providerStatus: provider,
    });
  }));

  router.get("/contracts/:id/esign/artifacts/:kind", run(async (request, response) => {
    const principal = await auth(request, "contracts:read", true);
    const id = pathParam(request, "id");
    const kind = pathParam(request, "kind");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) } });
    const proposalVersionId = (contract as { proposalVersionId?: string | null }).proposalVersionId ?? null;
    if (!proposalVersionId) throw new RouteError(404, "NOT_FOUND", "No signed artifact exists.");
    const requestRow = await prisma.contractEsignRequest.findFirst({ where: { contractId: contract.id, proposalVersionId } });
    if (!requestRow) throw new RouteError(404, "NOT_FOUND", "No signed artifact exists.");
    const artifact = await prisma.contractEsignArtifact.findFirst({ where: { requestId: requestRow.id, kind } });
    if (!artifact) throw new RouteError(404, "NOT_FOUND", "No signed artifact exists.");
    response.setHeader("content-type", "application/pdf");
    response.setHeader("content-disposition", `attachment; filename="unwhelm-esign-${kind}-${contract.id.slice(0, 8)}.pdf"`);
    response.status(200).send(Buffer.from(artifact.bytes));
  }));

  router.post("/contracts/:id/esign/cancel", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const runtime = esignRuntime(prisma);
    if (!runtime) throw new RouteError(404, "NOT_FOUND", "External e-sign is not enabled.");
    const id = pathParam(request, "id");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id, organizationId: requireOrganization(principal) } });
    const proposalVersionId = (contract as { proposalVersionId?: string | null }).proposalVersionId ?? null;
    if (!proposalVersionId) throw new RouteError(404, "NOT_FOUND", "No e-sign request exists.");
    const requestRow = await prisma.contractEsignRequest.findFirst({ where: { contractId: contract.id, proposalVersionId } });
    if (!requestRow) throw new RouteError(404, "NOT_FOUND", "No e-sign request exists.");
    await runtime.adapter.cancel(requestRow.providerDocumentId);
    const updated = await prisma.contractEsignRequest.update({ where: { id: requestRow.id }, data: { status: "cancelled", cancelledAt: new Date() } });
    ok(request, response, { id: updated.id, status: updated.status }, true);
  }));

  router.post("/esign/signwell/webhook", run(async (request, response) => {
    const runtime = esignRuntime(prisma);
    if (!runtime || runtime.provider !== "signwell") throw new RouteError(404, "NOT_FOUND", "Not found.");
    const secret = process.env.SIGNWELL_WEBHOOK_SECRET;
    if (!secret) throw new RouteError(503, "CONFIGURATION_REQUIRED", "Webhook secret is not configured.");
    const event = jsonObject(request.body) as never;
    const okSig = verifySignWellWebhookSignature({ secret, headers: request.headers as never, event });
    if (!okSig) throw new RouteError(401, "AUTH_REQUIRED", "Webhook signature is missing or invalid.");
    const providerDocumentId = signwellWebhookDocumentId(event);
    if (!providerDocumentId) throw new RouteError(400, "VALIDATION_FAILED", "Missing document id.");
    const reconciled = await reconcileEsignWebhook(
      { prisma, adapter: runtime.adapter, provider: runtime.provider, testMode: runtime.testMode, baseUrl: runtime.baseUrl },
      { providerDocumentId },
    );
    ok(request, response, { reconciled }, true);
  }));

  router.get("/esign/signwell/callback", run(async (_request, response) => {
    response.status(200).type("text/plain").send("Thanks — your signing status will update in Unwhelm shortly.");
  }));

  router.post("/esign/pandadoc/webhook", run(async (request, response) => {
    const runtime = esignRuntime(prisma);
    if (!runtime || runtime.provider !== "pandadoc") throw new RouteError(404, "NOT_FOUND", "Not found.");
    const secret = process.env.PANDADOC_WEBHOOK_SECRET;
    if (!secret) throw new RouteError(503, "CONFIGURATION_REQUIRED", "Webhook secret is not configured.");
    const rawBody = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
    const okSig = verifyPandaDocWebhookSignature({
      secret,
      headers: request.headers as never,
      query: request.query as never,
      rawBody,
    });
    if (!okSig) throw new RouteError(401, "AUTH_REQUIRED", "Webhook signature is missing or invalid.");
    const providerDocumentId = pandaDocWebhookDocumentId(request.body);
    if (!providerDocumentId) throw new RouteError(400, "VALIDATION_FAILED", "Missing document id.");
    const reconciled = await reconcileEsignWebhook(
      { prisma, adapter: runtime.adapter, provider: runtime.provider, testMode: runtime.testMode, baseUrl: runtime.baseUrl },
      { providerDocumentId },
    );
    ok(request, response, { reconciled }, true);
  }));

  router.get("/esign/pandadoc/callback", run(async (_request, response) => {
    response.status(200).type("text/plain").send("Thanks — your signing status will update in Unwhelm shortly.");
  }));

  router.post("/contracts/:id/cancel", run(async (request, response) => {
    const principal = await auth(request, "contracts:write", true);
    const current = await prisma.contract.findFirstOrThrow({ where: { id: pathParam(request, "id"), organizationId: requireOrganization(principal) } });
    if (current.status === "signed") throw new RouteError(409, "CONFLICT", "A signed contract cannot be cancelled.");
    const updated = await prisma.contract.update({ where: { id: current.id }, data: { status: "cancelled" } });
    ok(request, response, updated, true);
  }));

  router.get("/contracts/:id/handoff", run(async (request, response) => {
    const principal = await auth(request, "contracts:read");
    const contract = await prisma.contract.findFirstOrThrow({ where: { id: pathParam(request, "id"), ...(principal.organizationId ? { organizationId: principal.organizationId } : { proposal: { ownerId: principal.userId } }) }, include: { proposal: { include: proposalInclude } } });
    ok(request, response, { contract, proposal: proposalDocument(contract.proposal) });
  }));

  return router;
}

export { proposalDocument, RouteError };
