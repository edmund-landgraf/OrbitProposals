import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BillingScheduleError } from "../packages/shapes/src/index.js";
import {
  milestoneInvoiceDue,
  scheduleFromCatalog,
  signingInvoiceDue,
  templateIdFor,
  type ActiveCatalog,
} from "./catalog.js";
import { dueFromPaymentTerm, splitRetainage, type PaymentTermRow } from "./billingTerms.js";
import { applyOpenCredits, issueWorkflowCheckCredit, supportsCredits } from "./credits.js";
import { isExpired, loadExpiryConfig } from "./proposalExpiry.js";

const PERCENT_SCALE = 1_000_000;

export class AcceptError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export type FirstInvoiceRuleRow = {
  pricingModel: string;
  kind: string;
  percentBasis: number | null;
  periodDays: number | null;
  label: string;
};

export type FrozenSnapshot = {
  title: string;
  scope: unknown;
  timeline: unknown;
  pricing: unknown;
  options: unknown;
  milestones: Array<{ id?: string; title?: string; dueDate?: string | null; amountMinor?: number }>;
  terms?: string;
};

export function readSnapshot(value: unknown): FrozenSnapshot {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const milestones = Array.isArray(record.milestones) ? record.milestones : [];
  return {
    title: typeof record.title === "string" ? record.title : "",
    scope: record.scope ?? {},
    timeline: record.timeline ?? {},
    pricing: record.pricing ?? {},
    options: record.options ?? [],
    milestones: milestones.filter((item) => item && typeof item === "object") as FrozenSnapshot["milestones"],
    terms: typeof record.terms === "string" ? record.terms : undefined,
  };
}

export function pricingModelOf(pricing: unknown): string {
  if (!pricing || typeof pricing !== "object") return "";
  const model = (pricing as { model?: unknown }).model;
  return typeof model === "string" ? model : "";
}

export function totalMinorOf(pricing: unknown): { amountMinor: number; currency: "USD" } {
  const record = pricing && typeof pricing === "object" ? pricing as { amountMinor?: unknown; currency?: unknown; model?: unknown } : {};
  if (record.currency !== undefined && record.currency !== "USD") {
    throw new AcceptError(422, "UNSUPPORTED_CURRENCY", "Only USD pricing can be accepted.");
  }
  const currency = "USD" as const;
  if (record.model === "hourly") return { amountMinor: 0, currency };
  const amountMinor = typeof record.amountMinor === "number" ? record.amountMinor : 0;
  return { amountMinor, currency };
}

/** Deposit uses floor so a leftover cent stays on the later schedule line, matching the catalog allocator. */
export function depositMinor(totalMinor: number, percentBasis: number): number {
  return Math.floor(totalMinor * percentBasis / PERCENT_SCALE);
}

type ScheduleEntry = { label: string; percent: string; amountMinor: number; currency: string; trigger: string };

export function entriesForFirstInvoice(rule: FirstInvoiceRuleRow, entries: ScheduleEntry[], totalMinor: number): { amountMinor: number; labels: string[] } {
  if (rule.kind === "deposit_percent") {
    const amountMinor = depositMinor(totalMinor, rule.percentBasis ?? 0);
    const upfront = entries.filter((entry) => entry.trigger === "contract_signed");
    const exact = upfront.filter((entry) => entry.amountMinor === amountMinor);
    if (exact.length === 1 && exact[0]) return { amountMinor, labels: [exact[0].label] };
    const sum = upfront.reduce((total, entry) => total + entry.amountMinor, 0);
    if (upfront.length > 0 && sum === amountMinor) return { amountMinor, labels: upfront.map((entry) => entry.label) };
    return { amountMinor, labels: [] };
  }
  if (rule.kind === "first_milestone") {
    const first = entries.find((entry) => entry.trigger === "milestone_accepted");
    if (!first) return { amountMinor: 0, labels: [] };
    return { amountMinor: first.amountMinor, labels: [first.label] };
  }
  const manual = entries.filter((entry) => entry.trigger === "manual");
  const amountMinor = manual.reduce((total, entry) => total + entry.amountMinor, 0);
  return { amountMinor, labels: amountMinor > 0 ? manual.map((entry) => entry.label) : [] };
}

function dueFor(rule: FirstInvoiceRuleRow, catalog: ActiveCatalog, snapshot: FrozenSnapshot, now: Date): Date {
  if (rule.kind === "first_milestone") {
    const dated = snapshot.milestones.find((milestone) => milestone.dueDate);
    const due = dated?.dueDate ? new Date(dated.dueDate) : null;
    return milestoneInvoiceDue(catalog, due && !Number.isNaN(due.getTime()) ? due : null, now);
  }
  const base = signingInvoiceDue(catalog, now);
  if (rule.kind === "first_period" && rule.periodDays) {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + rule.periodDays);
    return next;
  }
  return base;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export type AcceptanceInvoice = {
  id: string;
  amountMinor: number;
  currency: string;
  dueDate: string;
  status: string;
  creditAppliedMinor: number;
};

export type AcceptanceResult = {
  proposalId: string;
  idempotent: boolean;
  contract: {
    id: string;
    proposalId: string;
    proposalVersionId: string | null;
    status: string;
    terms: string;
    scope: unknown;
    pricing: unknown;
    signedAt: string | null;
    paymentTermId?: string | null;
    retainagePercentBasis?: number;
    retainageHeldMinor?: number;
  };
  invoice: AcceptanceInvoice | null;
};

type ProposalRow = {
  id: string;
  organizationId: string | null;
  title: string;
  status: string;
  reviewState: string;
  approvedVersionId: string | null;
  catalogVersionId: string | null;
  pricing: unknown;
};

function presentContract(row: {
  id: string;
  proposalId: string;
  proposalVersionId: string | null;
  status: string;
  terms: string;
  scope: unknown;
  pricing: unknown;
  signedAt: Date | null;
}, invoice: AcceptanceInvoice | null, proposalId: string, idempotent: boolean): AcceptanceResult {
  return {
    proposalId,
    idempotent,
    contract: {
      id: row.id,
      proposalId: row.proposalId,
      proposalVersionId: row.proposalVersionId,
      status: row.status,
      terms: row.terms,
      scope: row.scope,
      pricing: row.pricing,
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      paymentTermId: "paymentTermId" in row ? (row as { paymentTermId?: string | null }).paymentTermId ?? null : null,
      retainagePercentBasis: "retainagePercentBasis" in row ? Number((row as { retainagePercentBasis?: number }).retainagePercentBasis ?? 0) : 0,
      retainageHeldMinor: "retainageHeldMinor" in row ? Number((row as { retainageHeldMinor?: number }).retainageHeldMinor ?? 0) : 0,
    },
    invoice,
  };
}

async function invoiceFor(tx: Prisma.TransactionClient, contractId: string): Promise<AcceptanceInvoice | null> {
  const invoice = await tx.invoice.findFirst({ where: { contractId }, orderBy: { createdAt: "asc" } });
  if (!invoice) return null;
  return {
    id: invoice.id,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    dueDate: invoice.dueDate.toISOString(),
    status: invoice.status,
    creditAppliedMinor: 0,
  };
}

export async function acceptProposal(
  prisma: PrismaClient,
  catalog: ActiveCatalog,
  input: {
    proposalId: string;
    organizationId: string;
    actorUserId: string | null;
    tokenId?: string | null;
    requestId: string;
    method: string;
    path: string;
    terms?: string;
    now?: Date;
  },
): Promise<AcceptanceResult> {
  const now = input.now ?? new Date();
  const run = () => prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "Proposal" WHERE "id" = $1::uuid FOR UPDATE`, input.proposalId);
    const proposal = await tx.proposal.findFirst({ where: { id: input.proposalId } }) as ProposalRow | null;
    if (!proposal || proposal.organizationId !== input.organizationId) throw new AcceptError(404, "NOT_FOUND", "The proposal was not found.");
    if (proposal.status === "closed") throw new AcceptError(409, "CONFLICT", "A closed proposal cannot be accepted.");
    const expiryConfig = await loadExpiryConfig(tx);
    // isExpired is false while proposals do not expire, including when valid_until is in the past.
    if (isExpired((proposal as { validUntil?: Date | null }).validUntil, now)) {
      throw new AcceptError(409, "EXPIRED", expiryConfig?.expiredMessage ?? "This proposal has expired.");
    }
    if (proposal.reviewState !== "approved" || !proposal.approvedVersionId) {
      throw new AcceptError(409, "CONFLICT", "Accept the locked approved version. This proposal is not approved.");
    }
    const version = await tx.proposalVersion.findUnique({ where: { id: proposal.approvedVersionId } });
    if (!version?.locked) throw new AcceptError(409, "CONFLICT", "The approved version is not locked.");
    const existing = await tx.contract.findFirst({ where: { proposalVersionId: version.id } });
    if (existing) {
      return presentContract(existing, await invoiceFor(tx, existing.id), proposal.id, true);
    }
    const snapshot = readSnapshot(version.snapshot);
    const pricing = snapshot.pricing;
    const model = pricingModelOf(pricing);
    if (!model) throw new AcceptError(400, "VALIDATION_FAILED", "The approved version has no pricing model.");
    const ruleDelegate = (tx as unknown as { firstInvoiceRule?: { findFirst: (args: { where: { catalogVersionId: string; pricingModel: string } }) => Promise<FirstInvoiceRuleRow | null> } }).firstInvoiceRule;
    const catalogVersionId = proposal.catalogVersionId ?? catalog.id;
    const rule = ruleDelegate ? await ruleDelegate.findFirst({ where: { catalogVersionId, pricingModel: model } }) : null;
    if (!rule) throw new AcceptError(409, "CONFLICT", "No first-invoice rule is configured for this pricing model.");
    const termDelegate = (tx as unknown as { paymentTerm?: { findFirst: (args: { where: { isDefault: boolean } }) => Promise<PaymentTermRow | null> }; retainageDefault?: { findFirst: (args: Record<string, never>) => Promise<{ percentBasis: number } | null> } });
    const paymentTerm = termDelegate.paymentTerm ? await termDelegate.paymentTerm.findFirst({ where: { isDefault: true } }) : null;
    const retainageDefault = termDelegate.retainageDefault ? await termDelegate.retainageDefault.findFirst({}) : null;
    const retainagePercentBasis = retainageDefault?.percentBasis ?? 0;
    let schedule;
    try { schedule = scheduleFromCatalog(catalog, pricing); }
    catch (error) {
      if (error instanceof BillingScheduleError) throw new AcceptError(400, "VALIDATION_FAILED", error.message);
      throw error;
    }
    const total = totalMinorOf(pricing);
    const selected = entriesForFirstInvoice(rule, schedule.entries, schedule.total.amountMinor || total.amountMinor);
    const terms = input.terms?.trim() || snapshot.terms || `Proposal ${snapshot.title || proposal.title}`;
    const contractId = randomUUID();
    const termDue = paymentTerm ? dueFromPaymentTerm(now, paymentTerm.days) : null;
    const rows = schedule.entries.map((entry) => ({
      id: randomUUID(),
      contractId,
      label: entry.label,
      percent: entry.percent,
      amountMinor: entry.amountMinor,
      currency: entry.currency,
      dueOn: termDue,
      trigger: entry.trigger,
      milestoneId: null as string | null,
      invoiceId: null as string | null,
    }));
    let invoice: AcceptanceInvoice | null = null;
    let creditAppliedMinor = 0;
    if (selected.amountMinor > 0) {
      const invoiceId = randomUUID();
      const dueDate = paymentTerm ? dueFromPaymentTerm(now, paymentTerm.days) : dueFor(rule, catalog, snapshot, now);
      const split = splitRetainage(selected.amountMinor, retainagePercentBasis);
      const invoiceAmount = split.netMinor;
      const linked = new Set(selected.labels);
      if (linked.size === 0) {
        rows.push({
          id: randomUUID(),
          contractId,
          label: rule.label,
          percent: "0.0000",
          amountMinor: selected.amountMinor,
          currency: total.currency,
          dueOn: dueDate,
          trigger: rule.kind === "first_milestone" ? "milestone_accepted" : "contract_signed",
          milestoneId: null,
          invoiceId,
        });
      }
      for (const row of rows) {
        if (linked.has(row.label)) {
          row.invoiceId = invoiceId;
          row.dueOn = dueDate;
        }
      }
      await tx.contract.create({
        data: {
          id: contractId,
          proposalId: proposal.id,
          organizationId: input.organizationId,
          status: "signed",
          terms,
          billing: { total: schedule.total, source: "proposal_accept" } as Prisma.InputJsonValue,
          signedAt: now,
          acceptedAt: now,
          proposalVersionId: version.id,
          scope: snapshot.scope as Prisma.InputJsonValue,
          pricing: pricing as Prisma.InputJsonValue,
          catalogVersionId,
          billingScheduleTemplateId: templateIdFor(catalog, model),
          paymentTermId: paymentTerm?.id ?? null,
          retainagePercentBasis,
          retainageHeldMinor: split.withheldMinor,
        },
      });
      await tx.billingEntry.createMany({ data: rows });
      await tx.invoice.create({
        data: {
          id: invoiceId,
          contractId,
          amountMinor: invoiceAmount,
          grossMinor: selected.amountMinor,
          retainageMinor: split.withheldMinor,
          kind: "standard",
          currency: rows.find((row) => row.invoiceId === invoiceId)?.currency ?? total.currency,
          dueDate,
          status: catalog.invoicePolicy.initialStatus,
        },
      });
      if (supportsCredits(tx) && model === "workflow_check") {
        await issueWorkflowCheckCredit(tx, {
          organizationId: input.organizationId,
          contractId,
          invoiceId,
          catalogVersionId,
          pricingModel: model,
          sourceAmountMinor: selected.amountMinor,
          currency: total.currency,
        });
      } else if (supportsCredits(tx)) {
        const applied = await applyOpenCredits(tx, {
          organizationId: input.organizationId,
          contractId,
          invoiceId,
          pricingModel: model,
          currency: total.currency,
          amountMinor: invoiceAmount,
          now,
        });
        creditAppliedMinor = invoiceAmount - applied.amountMinor;
      }
      const stored = await tx.invoice.findFirstOrThrow({ where: { id: invoiceId } });
      invoice = {
        id: stored.id,
        amountMinor: stored.amountMinor,
        currency: stored.currency,
        dueDate: stored.dueDate.toISOString(),
        status: stored.status,
        creditAppliedMinor,
      };
    } else {
      await tx.contract.create({
        data: {
          id: contractId,
          proposalId: proposal.id,
          organizationId: input.organizationId,
          status: "signed",
          terms,
          billing: { total: schedule.total, source: "proposal_accept" } as Prisma.InputJsonValue,
          signedAt: now,
          acceptedAt: now,
          proposalVersionId: version.id,
          scope: snapshot.scope as Prisma.InputJsonValue,
          pricing: pricing as Prisma.InputJsonValue,
          catalogVersionId,
          billingScheduleTemplateId: templateIdFor(catalog, model),
          paymentTermId: paymentTerm?.id ?? null,
          retainagePercentBasis,
          retainageHeldMinor: 0,
        },
      });
      if (rows.length) await tx.billingEntry.createMany({ data: rows });
    }
    await tx.proposal.update({ where: { id: proposal.id }, data: { status: "active", version: { increment: 1 } } });
    const contract = await tx.contract.findFirstOrThrow({ where: { id: contractId } });
    const previous = await tx.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
    const previousHash = previous?.hash ?? null;
    const payload = { proposalId: proposal.id, proposalVersionId: version.id, contractId, invoiceId: invoice?.id ?? null, idempotent: false };
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        tokenId: input.tokenId ?? null,
        operation: "proposal_accept",
        method: input.method,
        path: input.path,
        recordType: "contract",
        recordId: contractId,
        requestId: input.requestId,
        inputRedacted: payload as Prisma.InputJsonValue,
        statusCode: 201,
        previousHash,
        hash: digest(JSON.stringify({ previousHash, ...payload })),
      },
    });
    return presentContract(contract, invoice, proposal.id, false);
  });
  try { return await run(); }
  catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;
    const proposal = await prisma.proposal.findFirst({ where: { id: input.proposalId } });
    const versionId = proposal?.approvedVersionId;
    const existing = versionId ? await prisma.contract.findFirst({ where: { proposalVersionId: versionId } }) : null;
    if (!existing) throw error;
    const invoice = await prisma.invoice.findFirst({ where: { contractId: existing.id }, orderBy: { createdAt: "asc" } });
    return presentContract(existing, invoice ? {
      id: invoice.id,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status,
      creditAppliedMinor: 0,
    } : null, input.proposalId, true);
  }
}

export async function releaseRetainage(
  prisma: PrismaClient,
  catalog: ActiveCatalog,
  input: { contractId: string; organizationId: string; now?: Date },
): Promise<{ idempotent: boolean; heldMinor: number; invoice: AcceptanceInvoice }> {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({ where: { id: input.contractId, organizationId: input.organizationId } });
    if (!contract) throw new AcceptError(404, "NOT_FOUND", "The contract was not found.");
    const existing = await tx.invoice.findFirst({ where: { contractId: contract.id, kind: "retainage_release" } });
    if (contract.retainageHeldMinor <= 0) {
      if (!existing) throw new AcceptError(409, "CONFLICT", "This contract has no retainage to release.");
      return {
        idempotent: true,
        heldMinor: 0,
        invoice: { id: existing.id, amountMinor: existing.amountMinor, currency: existing.currency, dueDate: existing.dueDate.toISOString(), status: existing.status, creditAppliedMinor: 0 },
      };
    }
    const term = contract.paymentTermId
      ? await tx.paymentTerm.findUnique({ where: { id: contract.paymentTermId } })
      : await tx.paymentTerm.findFirst({ where: { isDefault: true } });
    const dueDate = term ? dueFromPaymentTerm(now, term.days) : signingInvoiceDue(catalog, now);
    const invoice = await tx.invoice.create({
      data: {
        contractId: contract.id,
        amountMinor: contract.retainageHeldMinor,
        grossMinor: contract.retainageHeldMinor,
        retainageMinor: 0,
        kind: "retainage_release",
        currency: (contract.pricing && typeof contract.pricing === "object" && "currency" in contract.pricing && typeof contract.pricing.currency === "string") ? contract.pricing.currency : "USD",
        dueDate,
        status: catalog.invoicePolicy.initialStatus,
      },
    });
    await tx.contract.update({ where: { id: contract.id }, data: { retainageHeldMinor: 0 } });
    return {
      idempotent: false,
      heldMinor: 0,
      invoice: { id: invoice.id, amountMinor: invoice.amountMinor, currency: invoice.currency, dueDate: invoice.dueDate.toISOString(), status: invoice.status, creditAppliedMinor: 0 },
    };
  });
}

/** Shows the contract terms and first invoice accept would create. It does not accept, sign, or invoice. */
export async function previewCommitment(prisma: PrismaClient, catalog: ActiveCatalog, proposalId: string, now = new Date()) {
  const proposal = await prisma.proposal.findFirst({ where: { id: proposalId }, include: { nodes: true, approvedVersion: true } });
  if (!proposal) throw new AcceptError(404, "NOT_FOUND", "The proposal was not found.");
  const termsNode = proposal.nodes.find((node) => node.key === "terms");
  const termsBody = termsNode?.body && typeof termsNode.body === "object" && !Array.isArray(termsNode.body) ? (termsNode.body as { text?: unknown }).text : undefined;
  const draftTerms = typeof termsBody === "string" ? termsBody : "";
  const blockers: string[] = [];
  if (proposal.reviewState !== "approved" || !proposal.approvedVersionId) blockers.push("The proposal is not an approved locked version.");
  const version = proposal.approvedVersion;
  if (proposal.approvedVersionId && !version?.locked) blockers.push("The approved version is not locked.");
  const snapshot = version ? readSnapshot(version.snapshot) : { title: proposal.title, scope: proposal.scope, timeline: proposal.timeline, pricing: proposal.pricing, options: [], milestones: [], terms: draftTerms };
  const terms = draftTerms || snapshot.terms || `Proposal ${snapshot.title || proposal.title}`;
  const pricing = snapshot.pricing;
  const model = pricingModelOf(pricing);
  if (!model) blockers.push("The proposal has no pricing model.");
  let invoice: { amountMinor: number; grossMinor: number; retainageMinor: number; currency: string; dueDate: string; status: string; label: string } | null = null;
  if (model && blockers.length === 0) {
    const catalogVersionId = proposal.catalogVersionId ?? catalog.id;
    const rule = await prisma.firstInvoiceRule.findFirst({ where: { catalogVersionId, pricingModel: model as never } });
    if (!rule) blockers.push("No first-invoice rule is configured for this pricing model.");
    else {
      const paymentTerm = await prisma.paymentTerm.findFirst({ where: { isDefault: true } });
      const retainageDefault = await prisma.retainageDefault.findFirst();
      let schedule;
      try { schedule = scheduleFromCatalog(catalog, pricing); }
      catch (error) {
        if (error instanceof BillingScheduleError) { blockers.push(error.message); schedule = null; }
        else throw error;
      }
      if (schedule) {
      const total = totalMinorOf(pricing);
      const selected = entriesForFirstInvoice(rule, schedule.entries, schedule.total.amountMinor || total.amountMinor);
      if (selected.amountMinor > 0) {
        const dueDate = paymentTerm ? dueFromPaymentTerm(now, paymentTerm.days) : dueFor(rule, catalog, snapshot, now);
        const split = splitRetainage(selected.amountMinor, retainageDefault?.percentBasis ?? 0);
        invoice = {
          amountMinor: split.netMinor,
          grossMinor: selected.amountMinor,
          retainageMinor: split.withheldMinor,
          currency: total.currency,
          dueDate: dueDate.toISOString(),
          status: catalog.invoicePolicy.initialStatus,
          label: selected.labels[0] ?? rule.label,
        };
      }
      }
    }
  }
  return {
    dryRun: true,
    creates: [] as string[],
    ready: blockers.length === 0,
    blockers,
    contract: { terms, scope: snapshot.scope, pricing, status: blockers.length === 0 ? "would_sign" : "not_ready" },
    invoice,
  };
}
