import { randomUUID } from "node:crypto";

const PERCENT_SCALE = 1_000_000;
const DAY_MS = 86_400_000;

export type CreditRuleRow = {
  id: string;
  code: string;
  sourcePricingModel: string;
  sourceTierCode: string;
  windowDays: number;
  creditAmountMinor: number | null;
  creditPercentBasis: number | null;
  currency: string;
  targets: Array<{ pricingModel: string; tierCode: string }>;
};

export type ContractCreditRow = {
  id: string;
  organizationId: string;
  sourceContractId: string;
  sourceInvoiceId: string;
  creditRuleId: string;
  amountMinor: number;
  currency: string;
  issuedAt: Date;
  expiresAt: Date;
  redeemedAt: Date | null;
  redeemedInvoiceId: string | null;
  voidedAt: Date | null;
  creditRule?: CreditRuleRow;
};

type CreditDb = {
  creditRule: {
    findMany: (args: {
      where: { catalogVersionId: string; sourcePricingModel?: string };
      include: { targets: true };
    }) => Promise<CreditRuleRow[]>;
  };
  contractCredit: {
    findFirst: (args: { where: Record<string, unknown>; include?: { creditRule: { include: { targets: true } } } }) => Promise<ContractCreditRow | null>;
    findMany: (args: { where: Record<string, unknown>; include?: { creditRule: { include: { targets: true } } }; orderBy?: { expiresAt: "asc" }; take?: number }) => Promise<ContractCreditRow[]>;
    create: (args: { data: Record<string, unknown> }) => Promise<ContractCreditRow>;
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<ContractCreditRow>;
  };
  billingEntry: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  invoice: {
    findFirst: (args: { where: Record<string, unknown>; include?: unknown }) => Promise<{
      id: string;
      contractId: string;
      amountMinor: number;
      currency: string;
      status: string;
      contract?: { organizationId: string; proposal?: { pricing: unknown } | null };
    } | null>;
    update: (args: { where: { id: string }; data: { amountMinor: number } }) => Promise<{ id: string; amountMinor: number }>;
  };
};

export class CreditError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function supportsCredits(db: object): db is CreditDb {
  return "contractCredit" in db && "creditRule" in db;
}

/** Fixed amount when the rule has one. Otherwise the percent of the source invoice, on the 1_000_000 = 100% scale. */
export function creditAmountMinor(rule: Pick<CreditRuleRow, "creditAmountMinor" | "creditPercentBasis">, sourceAmountMinor: number): number {
  if (rule.creditAmountMinor != null) return rule.creditAmountMinor;
  if (rule.creditPercentBasis == null) return 0;
  return Math.round(sourceAmountMinor * rule.creditPercentBasis / PERCENT_SCALE);
}

export function creditExpiresAt(issuedAt: Date, windowDays: number): Date {
  return new Date(issuedAt.getTime() + windowDays * DAY_MS);
}

export function creditStatus(credit: Pick<ContractCreditRow, "voidedAt" | "redeemedAt" | "expiresAt">, now = new Date()): "void" | "redeemed" | "expired" | "open" {
  if (credit.voidedAt) return "void";
  if (credit.redeemedAt) return "redeemed";
  if (credit.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

function ruleMatchesSource(rule: CreditRuleRow, pricingModel: string, tierCode: string | null): boolean {
  if (rule.sourcePricingModel !== pricingModel) return false;
  if (!rule.sourceTierCode) return true;
  return tierCode == null || rule.sourceTierCode === tierCode;
}

function ruleMatchesTarget(rule: CreditRuleRow, pricingModel: string): boolean {
  if (rule.targets.length === 0) return pricingModel !== rule.sourcePricingModel;
  return rule.targets.some((target) => target.pricingModel === pricingModel);
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function issueWorkflowCheckCredit(
  db: object,
  input: {
    organizationId: string;
    contractId: string;
    invoiceId: string;
    catalogVersionId: string | null;
    pricingModel: string;
    tierCode?: string | null;
    sourceAmountMinor: number;
    currency: string;
    now?: Date;
  },
): Promise<ContractCreditRow | null> {
  if (!supportsCredits(db) || !input.catalogVersionId || input.pricingModel !== "workflow_check") return null;
  const existing = await db.contractCredit.findFirst({ where: { sourceContractId: input.contractId } });
  if (existing) return existing;
  const rules = await db.creditRule.findMany({
    where: { catalogVersionId: input.catalogVersionId, sourcePricingModel: "workflow_check" },
    include: { targets: true },
  });
  const rule = rules.find((item) => item.currency === input.currency && ruleMatchesSource(item, input.pricingModel, input.tierCode ?? "workflow_check"));
  if (!rule) return null;
  const amountMinor = creditAmountMinor(rule, input.sourceAmountMinor);
  if (amountMinor <= 0) return null;
  const issuedAt = input.now ?? new Date();
  try {
    return await db.contractCredit.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        sourceContractId: input.contractId,
        sourceInvoiceId: input.invoiceId,
        creditRuleId: rule.id,
        amountMinor,
        currency: input.currency,
        issuedAt,
        expiresAt: creditExpiresAt(issuedAt, rule.windowDays),
      },
    });
  } catch (error) {
    if (!isUnique(error)) throw error;
    return db.contractCredit.findFirst({ where: { sourceContractId: input.contractId } });
  }
}

export type AppliedCredit = { creditId: string; amountMinor: number; lineId: string };

/**
 * Redeems open, unexpired credits for this organization onto the invoice as negative billing lines.
 * A credit is claimed with a conditional update so a second apply finds it already redeemed.
 */
export async function applyOpenCredits(
  db: object,
  input: {
    organizationId: string;
    contractId: string;
    invoiceId: string;
    pricingModel: string;
    currency: string;
    amountMinor: number;
    now?: Date;
    creditId?: string;
  },
): Promise<{ amountMinor: number; applied: AppliedCredit[] }> {
  if (!supportsCredits(db)) return { amountMinor: input.amountMinor, applied: [] };
  const now = input.now ?? new Date();
  const where: Record<string, unknown> = input.creditId
    ? { id: input.creditId, organizationId: input.organizationId }
    : { organizationId: input.organizationId, redeemedAt: null, voidedAt: null, expiresAt: { gt: now }, sourceContractId: { not: input.contractId } };
  const credits = await db.contractCredit.findMany({
    where,
    include: { creditRule: { include: { targets: true } } },
    orderBy: { expiresAt: "asc" },
    take: input.creditId ? 1 : 20,
  });
  if (input.creditId && credits.length === 0) throw new CreditError(404, "NOT_FOUND", "The credit was not found.");
  let remaining = input.amountMinor;
  const applied: AppliedCredit[] = [];
  for (const credit of credits) {
    if (input.creditId) assertApplicable(credit, input, now);
    else if (!credit.creditRule || !ruleMatchesTarget(credit.creditRule, input.pricingModel) || credit.currency !== input.currency || credit.sourceContractId === input.contractId) continue;
    if (remaining <= 0) break;
    const portion = Math.min(credit.amountMinor, remaining);
    const claimed = await db.contractCredit.updateMany({
      where: { id: credit.id, redeemedAt: null, voidedAt: null, expiresAt: { gt: now } },
      data: { redeemedAt: now, redeemedInvoiceId: input.invoiceId },
    });
    if (claimed.count !== 1) {
      if (input.creditId) throw new CreditError(409, "CONFLICT", "The credit was already redeemed.");
      continue;
    }
    const line = await db.billingEntry.create({
      data: {
        id: randomUUID(),
        contractId: input.contractId,
        label: `Workflow Check credit ${credit.id}`,
        percent: 0,
        amountMinor: -portion,
        currency: credit.currency,
        dueOn: null,
        trigger: "manual",
        milestoneId: null,
        invoiceId: input.invoiceId,
      },
    });
    remaining -= portion;
    applied.push({ creditId: credit.id, amountMinor: portion, lineId: line.id });
  }
  if (applied.length > 0) {
    await db.invoice.update({ where: { id: input.invoiceId }, data: { amountMinor: remaining } });
  }
  return { amountMinor: remaining, applied };
}

function assertApplicable(credit: ContractCreditRow, input: { contractId: string; pricingModel: string; currency: string; amountMinor: number }, now: Date): void {
  if (credit.voidedAt) throw new CreditError(409, "CONFLICT", "A voided credit cannot be applied.");
  if (credit.redeemedAt) throw new CreditError(409, "CONFLICT", "The credit was already redeemed.");
  if (credit.expiresAt.getTime() <= now.getTime()) throw new CreditError(409, "CONFLICT", "The credit has expired.");
  if (credit.sourceContractId === input.contractId) throw new CreditError(409, "CONFLICT", "A credit cannot be applied to the contract that issued it.");
  if (credit.currency !== input.currency) throw new CreditError(409, "CONFLICT", "The credit currency does not match the invoice.");
  if (!credit.creditRule || !ruleMatchesTarget(credit.creditRule, input.pricingModel)) {
    throw new CreditError(409, "CONFLICT", "This credit does not apply to that pricing model.");
  }
  if (input.amountMinor <= 0) throw new CreditError(409, "CONFLICT", "The invoice has no balance to credit.");
}

export async function voidCredit(db: CreditDb, id: string, organizationId: string, now = new Date()): Promise<ContractCreditRow> {
  const credit = await db.contractCredit.findFirst({ where: { id, organizationId } });
  if (!credit) throw new CreditError(404, "NOT_FOUND", "The credit was not found.");
  if (credit.redeemedAt) throw new CreditError(409, "CONFLICT", "A redeemed credit cannot be voided.");
  if (credit.voidedAt) throw new CreditError(409, "CONFLICT", "The credit is already void.");
  const claimed = await db.contractCredit.updateMany({
    where: { id, organizationId, redeemedAt: null, voidedAt: null },
    data: { voidedAt: now },
  });
  if (claimed.count !== 1) throw new CreditError(409, "CONFLICT", "The credit changed before it could be voided.");
  const updated = await db.contractCredit.findFirst({ where: { id } });
  if (!updated) throw new CreditError(404, "NOT_FOUND", "The credit was not found.");
  return updated;
}

export function presentCredit(credit: ContractCreditRow, now = new Date()) {
  return {
    id: credit.id,
    organizationId: credit.organizationId,
    sourceContractId: credit.sourceContractId,
    sourceInvoiceId: credit.sourceInvoiceId,
    creditRuleId: credit.creditRuleId,
    amount: { amountMinor: credit.amountMinor, currency: credit.currency },
    issuedAt: credit.issuedAt.toISOString(),
    expiresAt: credit.expiresAt.toISOString(),
    redeemedAt: credit.redeemedAt ? credit.redeemedAt.toISOString() : null,
    redeemedInvoiceId: credit.redeemedInvoiceId,
    voidedAt: credit.voidedAt ? credit.voidedAt.toISOString() : null,
    status: creditStatus(credit, now),
  };
}

export async function pricingModelOf(db: { contract: { findFirst: (args: { where: { id: string }; include: { proposal: true } }) => Promise<{ organizationId: string; catalogVersionId: string | null; proposal: { pricing: unknown } | null } | null> } }, contractId: string): Promise<{ organizationId: string; catalogVersionId: string | null; pricingModel: string } | null> {
  const contract = await db.contract.findFirst({ where: { id: contractId }, include: { proposal: true } });
  if (!contract) return null;
  const pricing = contract.proposal?.pricing as { model?: string } | null;
  return { organizationId: contract.organizationId, catalogVersionId: contract.catalogVersionId, pricingModel: pricing?.model ?? "" };
}
