import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import session from "express-session";
import { invalidateCatalogCache, loadActiveCatalog, parseCatalogPricing, seedCatalogFixture, type ActiveCatalog } from "../../server/catalog.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

const userId = "11111111-1111-4111-8111-111111111111";
const organizationId = "55555555-5555-4555-8555-555555555555";

function catalogRow(catalog: ActiveCatalog, updatedAt: Date) {
  const models = [...new Set(catalog.tiers.map((tier) => tier.model))].map((code, index) => ({ id: `00000000-0000-4000-8000-00000000010${index}`, code }));
  const modelId = new Map(models.map((model) => [model.code, model.id]));
  return {
    id: catalog.id,
    updatedAt,
    effectiveFrom: new Date(catalog.effectiveFrom),
    effectiveTo: null,
    pricingModels: models,
    priceTiers: catalog.tiers.map((tier) => ({ ...tier, pricingModelId: modelId.get(tier.model) })),
    billingScheduleTemplates: catalog.templates.map((template) => ({
      ...template,
      pricingModelId: modelId.get(template.model),
      lines: template.lines,
    })),
    invoicePolicy: catalog.invoicePolicy,
    invoiceStatusTransitions: catalog.transitions,
    oauthScopes: catalog.mcpScopes.map((scope) => ({ scope, mcp: true })),
    sessionScopeGrants: catalog.grants,
  };
}

test("changing a price tier changes a new proposal and leaves a signed contract", async () => {
  invalidateCatalogCache();
  const source = seedCatalogFixture();
  let updatedAt = new Date("2026-01-01T00:00:00.000Z");
  let row = catalogRow(source, updatedAt);
  const contracts = new Map<string, { id: string; organizationId: string; status: string; signedAt: Date | null; billing: unknown; proposal: { pricing: unknown; pricingModel: string; catalogVersionId: string | null }; entries: Array<{ id: string; label: string; amountMinor: number; currency: string; trigger: string; invoiceId: string | null; milestoneId: null; percent: string; dueOn: null }> }>();
  const db = {
    catalogVersion: {
      findFirst: async ({ select }: { select?: { id: boolean } }) => {
        if (select) return { id: row.id, updatedAt: row.updatedAt };
        return row;
      },
    },
    membership: { findFirst: async () => ({ organizationId, role: "staff", status: "active" }) },
    contract: {
      findFirstOrThrow: async ({ where }: { where: { id: string } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw Object.assign(new Error("missing"), { code: "P2025" });
        return { ...contract, entries: contract.entries, terms: "Terms", billing: contract.billing, createdAt: updatedAt, updatedAt, proposalId: randomUUID() };
      },
      update: async ({ where, data }: { where: { id: string }; data: { status?: string; signedAt?: Date; billing?: unknown; catalogVersion?: { connect: { id: string } }; billingScheduleTemplate?: { connect: { id: string } } } }) => {
        const contract = contracts.get(where.id);
        if (!contract) throw new Error("missing");
        if (data.status) contract.status = data.status;
        if (data.signedAt) contract.signedAt = data.signedAt;
        if (data.billing !== undefined) contract.billing = data.billing;
        if (data.catalogVersion?.connect.id) contract.proposal.catalogVersionId = data.catalogVersion.connect.id;
        return { ...contract, entries: contract.entries };
      },
    },
    billingEntry: {
      createMany: async ({ data }: { data: Array<{ id: string; label: string; amountMinor: number; currency: string; trigger: string; percent: string }> }) => {
        const contractId = data[0] && "contractId" in data[0] ? String((data[0] as { contractId: string }).contractId) : "";
        const contract = contracts.get(contractId);
        if (contract) contract.entries.push(...data.map((entry) => ({ ...entry, invoiceId: null, milestoneId: null as null, dueOn: null as null, percent: entry.percent })));
        return { count: data.length };
      },
      updateMany: async () => ({ count: 1 }),
    },
    invoice: { create: async ({ data }: { data: { amountMinor: number } }) => ({ id: randomUUID(), ...data }) },
    $queryRawUnsafe: async () => [],
    $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback(db),
  };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = userId; next(); });
  app.use("/api/v1", createProposalContractRouter({ prisma: db as never }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const contractId = randomUUID();
  contracts.set(contractId, {
    id: contractId,
    organizationId,
    status: "draft",
    signedAt: null,
    billing: {},
    proposal: { pricing: { model: "workflow_check", amountMinor: 25_000, currency: "USD" }, pricingModel: "workflow_check", catalogVersionId: null },
    entries: [],
  });
  try {
    const signed = await fetch(`${base}/api/v1/contracts/${contractId}/sign`, { method: "POST", headers: { "content-type": "application/json" } });
    const signedBody = await signed.json() as { ok: boolean; entity: { entries: Array<{ amountMinor: number }> } };
    assert.equal(signed.status, 200);
    assert.equal(signedBody.entity.entries[0]?.amountMinor, 25_000);
    const workflow = row.priceTiers.find((tier) => tier.code === "workflow_check");
    if (!workflow) throw new Error("missing tier");
    workflow.amountMinor = 26_000;
    updatedAt = new Date("2026-02-01T00:00:00.000Z");
    row = { ...row, updatedAt };
    invalidateCatalogCache();
    const active = await loadActiveCatalog(db as never);
    assert.equal(active.tiers.find((tier) => tier.code === "workflow_check")?.amountMinor, 26_000);
    assert.throws(() => parseCatalogPricing(active, "workflow_check", { model: "workflow_check", amountMinor: 25_000, currency: "USD" }));
    const next = parseCatalogPricing(active, "workflow_check", { model: "workflow_check", amountMinor: 26_000, currency: "USD" });
    assert.equal(next.model === "workflow_check" && next.amountMinor, 26_000);
    const again = await fetch(`${base}/api/v1/contracts/${contractId}/sign`, { method: "POST", headers: { "content-type": "application/json" } });
    const againBody = await again.json() as { entity: { entries: Array<{ amountMinor: number }> } };
    assert.equal(again.status, 200);
    assert.equal(againBody.entity.entries[0]?.amountMinor, 25_000);
    assert.equal(contracts.get(contractId)?.proposal.catalogVersionId, source.id);
  } finally {
    server.close();
    invalidateCatalogCache();
  }
});
