import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { BillingScheduleError, contractSignedInvoiceAmount, formatBillingPercent } from "../../packages/shapes/src/index.js";
import { applyOpenCredits, issueWorkflowCheckCredit, supportsCredits } from "../credits.js";
import { loadActiveCatalog, scheduleFromCatalog, signingInvoiceDue, templateIdFor } from "../catalog.js";
import { lockedPricing } from "../proposalReviewStore.js";

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

const prismaJson = (value: unknown) => value as Prisma.InputJsonValue;

const upfrontInvoiceId = (entries: Array<{ trigger: string; invoiceId: string | null }>): string | null => {
  const ids = [...new Set(entries.filter((entry) => entry.trigger === "contract_signed" && entry.invoiceId).map((entry) => entry.invoiceId))];
  return ids.length === 1 ? ids[0] ?? null : null;
};

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

/**
 * Marks a contract signed (idempotent) and triggers the existing signing invoice semantics.
 * Used by both the client portal and external e-sign provider webhook reconciliation.
 */
export async function signContract(prisma: PrismaClient, contractId: string): Promise<{ contract: unknown; changed: boolean; invoiceId: string | null }> {
  const catalog = await loadActiveCatalog(prisma);

  const runOnce = () => prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(`SELECT "id" FROM "Contract" WHERE "id" = $1::uuid FOR UPDATE`, contractId);
    const fresh = await tx.contract.findFirstOrThrow({ where: { id: contractId }, include: { entries: true, proposal: true } });
    if (fresh.status === "cancelled") throw Object.assign(new Error("A cancelled contract cannot be signed."), { code: "CONFLICT" });
    const alreadySigned = fresh.status === "signed" && fresh.signedAt != null && fresh.entries.length > 0;

    const data: Prisma.ContractUpdateInput = {};
    let entries: SignedContractEntry[] = fresh.entries;
    let scheduleTotal: { amountMinor: number; currency: string } | null = null;

    if (fresh.entries.length === 0) {
      const versionId = (fresh as { proposalVersionId?: string | null }).proposalVersionId ?? (fresh.proposal as { approvedVersionId?: string | null }).approvedVersionId;
      const locked = await lockedPricing(tx as unknown as typeof prisma, versionId);
      const agreedPricing = locked ?? (fresh as { pricing?: unknown }).pricing ?? fresh.proposal.pricing;
      let schedule;
      try { schedule = scheduleFromCatalog(catalog, agreedPricing); }
      catch (error) {
        if (error instanceof BillingScheduleError) throw Object.assign(new Error(error.message), { code: "VALIDATION_FAILED" });
        throw error;
      }
      const rows = schedule.entries.map((entry) => ({ id: randomUUID(), contractId: fresh.id, label: entry.label, percent: entry.percent, amountMinor: entry.amountMinor, currency: entry.currency, dueOn: null, trigger: entry.trigger, milestoneId: null, invoiceId: null }));
      await tx.billingEntry.createMany({ data: rows });
      entries = rows;
      scheduleTotal = schedule.total;
      const proposalRecord = fresh.proposal as { catalogVersionId?: string | null; pricingModel?: string; pricing?: { model?: string } };
      data.catalogVersion = { connect: { id: proposalRecord.catalogVersionId ?? catalog.id } };
      data.billingScheduleTemplate = { connect: { id: templateIdFor(catalog, proposalRecord.pricingModel ?? proposalRecord.pricing?.model ?? "") } };
    }

    const upfront = entries.filter((entry) => entry.trigger === "contract_signed" && entry.invoiceId == null);
    let priced: { amountMinor: number; currency: string } | null = null;
    try { priced = contractSignedInvoiceAmount(upfront); }
    catch (error) {
      if (error instanceof BillingScheduleError) throw Object.assign(new Error(error.message), { code: "VALIDATION_FAILED" });
      throw error;
    }

    let invoiceId = upfrontInvoiceId(entries);
    if (priced && catalog.invoicePolicy.invoiceOnSign) {
      const created = await tx.invoice.create({
        data: { contractId: fresh.id, amountMinor: priced.amountMinor, currency: priced.currency, dueDate: signingInvoiceDue(catalog), status: catalog.invoicePolicy.initialStatus },
      });
      const claimed = await tx.billingEntry.updateMany({
        where: { id: { in: upfront.map((entry) => entry.id) }, invoiceId: null },
        data: { invoiceId: created.id },
      });
      if (claimed.count !== upfront.length) throw Object.assign(new Error("Contract signing entries were already invoiced."), { code: "P2002" });
      const claimedIds = new Set(upfront.map((entry) => entry.id));
      entries = entries.map((entry) => claimedIds.has(entry.id) ? { ...entry, invoiceId: created.id } : entry);
      invoiceId = created.id;
      const pricingModel = (fresh.proposal.pricing as { model?: string } | null)?.model ?? "";
      const catalogVersionId = (fresh.proposal as { catalogVersionId?: string | null }).catalogVersionId ?? fresh.catalogVersionId ?? catalog.id;
      if (supportsCredits(tx) && pricingModel === "workflow_check") {
        await issueWorkflowCheckCredit(tx, {
          organizationId: fresh.organizationId,
          contractId: fresh.id,
          invoiceId: created.id,
          catalogVersionId,
          pricingModel,
          sourceAmountMinor: priced.amountMinor,
          currency: priced.currency,
        });
      } else if (supportsCredits(tx) && pricingModel) {
        await applyOpenCredits(tx, {
          organizationId: fresh.organizationId,
          contractId: fresh.id,
          invoiceId: created.id,
          pricingModel,
          currency: priced.currency,
          amountMinor: priced.amountMinor,
        });
      }
    }

    if (scheduleTotal) data.billing = prismaJson(scheduleSnapshot(entries, scheduleTotal));
    if (!alreadySigned) {
      data.status = "signed";
      data.signedAt = fresh.signedAt ?? new Date();
    }

    const changed = !alreadySigned || invoiceId !== upfrontInvoiceId(fresh.entries);
    const contract = Object.keys(data).length > 0
      ? await tx.contract.update({ where: { id: fresh.id }, data, include: { entries: true } })
      : await tx.contract.findFirstOrThrow({ where: { id: fresh.id }, include: { entries: true } });
    return { contract, changed, invoiceId };
  });

  try { return await runOnce(); }
  catch (error) {
    const prismaCode = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (prismaCode !== "P2002") throw error;
    return await runOnce();
  }
}

