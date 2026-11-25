import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { seedCatalogFixture } from "../../server/catalog.js";
import { acceptProposal, depositMinor, entriesForFirstInvoice, readSnapshot } from "../../server/proposalAccept.js";
import { AcceptError } from "../../server/proposalAccept.js";

const migration = readFileSync(new URL("../../prisma/migrations/0022_accept_proposal/migration.sql", import.meta.url), "utf8");

test("first-invoice rules are catalog rows, one per pricing model", () => {
  assert.match(migration, /'workflow_check', 'deposit_percent', 1000000/);
  assert.match(migration, /'capped_hours', 'deposit_percent', 1000000/);
  assert.match(migration, /'fixed_price', 'deposit_percent', 500000/);
  assert.match(migration, /'hourly', 'first_period', NULL, 30/);
  assert.match(migration, /Contract_proposal_version_id_key/);
});

test("deposit floor leaves a leftover cent off the first invoice", () => {
  assert.equal(depositMinor(300_001, 500_000), 150_000);
  assert.equal(depositMinor(25_000, 1_000_000), 25_000);
});

test("the rule picks the deposit, the first milestone, or the first period", () => {
  const entries = [
    { label: "Deposit", percent: "50.0000", amountMinor: 150_000, currency: "USD", trigger: "contract_signed" },
    { label: "Milestone acceptance", percent: "50.0000", amountMinor: 150_000, currency: "USD", trigger: "milestone_accepted" },
    { label: "Hourly", percent: "100.0000", amountMinor: 0, currency: "USD", trigger: "manual" },
  ];
  assert.deepEqual(entriesForFirstInvoice({ pricingModel: "fixed_price", kind: "deposit_percent", percentBasis: 500_000, periodDays: null, label: "Deposit" }, entries, 300_000), { amountMinor: 150_000, labels: ["Deposit"] });
  assert.deepEqual(entriesForFirstInvoice({ pricingModel: "fixed_price", kind: "first_milestone", percentBasis: null, periodDays: null, label: "First milestone" }, entries, 300_000).labels, ["Milestone acceptance"]);
  assert.deepEqual(entriesForFirstInvoice({ pricingModel: "hourly", kind: "first_period", percentBasis: null, periodDays: 30, label: "First period" }, entries, 0), { amountMinor: 0, labels: [] });
});

test("the snapshot keeps scope, price, and terms", () => {
  const snapshot = readSnapshot({ title: "Map", scope: { summary: "One workflow" }, pricing: { model: "fixed_price", amountMinor: 300_000, currency: "USD" }, terms: "Net terms", milestones: [] });
  assert.equal(snapshot.terms, "Net terms");
  assert.equal((snapshot.scope as { summary: string }).summary, "One workflow");
});

test("accepting an approved proposal creates one contract and the deposit invoice, and a second accept is the same pair", async () => {
  const db = memory();
  const catalog = seedCatalogFixture();
  const first = await acceptProposal(db as never, catalog, { proposalId: db.row.id, organizationId: db.row.organizationId, actorUserId: "user-1", requestId: randomUUID(), method: "POST", path: "/api/v1/proposals/x/accept" });
  assert.equal(first.idempotent, false);
  assert.equal(first.contract.proposalVersionId, db.version.id);
  assert.equal((first.contract.scope as { summary: string }).summary, "One workflow");
  assert.equal(first.invoice?.amountMinor, 150_000);
  assert.equal(first.invoice?.status, "draft");
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0]?.operation, "proposal_accept");
  const second = await acceptProposal(db as never, catalog, { proposalId: db.row.id, organizationId: db.row.organizationId, actorUserId: "user-1", requestId: randomUUID(), method: "POST", path: "/api/v1/proposals/x/accept" });
  assert.equal(second.idempotent, true);
  assert.equal(second.contract.id, first.contract.id);
  assert.equal(second.invoice?.id, first.invoice?.id);
  assert.equal(db.contracts.length, 1);
  assert.equal(db.invoices.length, 1);
  assert.equal(db.audits.length, 1);
});

test("a proposal that is still in review cannot be accepted", async () => {
  const db = memory();
  db.row.reviewState = "in_review";
  await assert.rejects(() => acceptProposal(db as never, seedCatalogFixture(), { proposalId: db.row.id, organizationId: db.row.organizationId, actorUserId: "user-1", requestId: randomUUID(), method: "POST", path: "/accept" }), (error: unknown) => error instanceof AcceptError && error.status === 409);
});

test("an open Workflow Check credit is applied to the first invoice", async () => {
  const db = memory();
  db.row.pricing = { model: "fixed_price", amountMinor: 300_000, currency: "USD" };
  db.version.snapshot = {
    title: "Map",
    scope: { summary: "One workflow" },
    timeline: {},
    pricing: db.row.pricing,
    options: [],
    milestones: [],
    terms: "Signed terms",
  };
  const creditId = randomUUID();
  db.credits.push({
    id: creditId,
    organizationId: db.row.organizationId,
    sourceContractId: randomUUID(),
    sourceInvoiceId: randomUUID(),
    creditRuleId: "rule-1",
    amountMinor: 25_000,
    currency: "USD",
    issuedAt: new Date("2026-10-01T00:00:00.000Z"),
    expiresAt: new Date("2026-12-01T00:00:00.000Z"),
    redeemedAt: null,
    voidedAt: null,
    redeemedInvoiceId: null,
    creditRule: { id: "rule-1", code: "workflow_check_follow_on", sourcePricingModel: "workflow_check", sourceTierCode: "workflow_check", windowDays: 30, creditAmountMinor: 25_000, creditPercentBasis: null, currency: "USD", targets: [{ pricingModel: "fixed_price", tierCode: "" }] },
  });
  const result = await acceptProposal(db as never, seedCatalogFixture(), { proposalId: db.row.id, organizationId: db.row.organizationId, actorUserId: "user-1", requestId: randomUUID(), method: "POST", path: "/accept", now: new Date("2026-10-23T00:00:00.000Z") });
  assert.equal(result.invoice?.creditAppliedMinor, 25_000);
  assert.equal(result.invoice?.amountMinor, 125_000);
  assert.equal(db.credits[0]?.redeemedInvoiceId, result.invoice?.id);
});

function memory() {
  const proposalId = randomUUID();
  const versionId = randomUUID();
  const organizationId = randomUUID();
  const state = {
    proposal: {
      id: proposalId,
      organizationId,
      title: "Map",
      status: "pending_approval",
      reviewState: "approved",
      approvedVersionId: versionId,
      catalogVersionId: "00000000-0000-4000-8000-000000000001",
      pricing: { model: "fixed_price", amountMinor: 300_000, currency: "USD" },
      version: 2,
    },
    version: {
      id: versionId,
      locked: true,
      snapshot: {
        title: "Map",
        scope: { summary: "One workflow" },
        timeline: {},
        pricing: { model: "fixed_price", amountMinor: 300_000, currency: "USD" },
        options: [],
        milestones: [],
        terms: "Signed terms",
      },
    },
    contracts: [] as Array<Record<string, unknown>>,
    entries: [] as Array<Record<string, unknown>>,
    invoices: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    credits: [] as Array<Record<string, unknown>>,
  };
  const api = {
    proposal: state.proposal,
    version: state.version,
    contracts: state.contracts,
    invoices: state.invoices,
    audits: state.audits,
    credits: state.credits,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(api),
    $queryRawUnsafe: async () => [],
    proposalVersion: { findUnique: async ({ where }: { where: { id: string } }) => where.id === state.version.id ? state.version : null },
    contract: {
      findFirst: async ({ where }: { where: { proposalVersionId?: string; id?: string } }) => state.contracts.find((row) => (where.id ? row.id === where.id : row.proposalVersionId === where.proposalVersionId)) ?? null,
      findFirstOrThrow: async (args: { where: { id: string } }) => {
        const row = state.contracts.find((item) => item.id === args.where.id);
        if (!row) throw new Error("missing contract");
        return row;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => { state.contracts.push({ ...data, signedAt: data.signedAt ?? null }); return data; },
    },
    firstInvoiceRule: {
      findFirst: async ({ where }: { where: { pricingModel: string } }) => {
        const rules: Record<string, { pricingModel: string; kind: string; percentBasis: number | null; periodDays: number | null; label: string }> = {
          fixed_price: { pricingModel: "fixed_price", kind: "deposit_percent", percentBasis: 500_000, periodDays: null, label: "Deposit" },
          workflow_check: { pricingModel: "workflow_check", kind: "deposit_percent", percentBasis: 1_000_000, periodDays: null, label: "Workflow Check" },
          hourly: { pricingModel: "hourly", kind: "first_period", percentBasis: null, periodDays: 30, label: "First period" },
        };
        return rules[where.pricingModel] ?? null;
      },
    },
    billingEntry: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { state.entries.push(...data); return { count: data.length }; },
      create: async ({ data }: { data: Record<string, unknown> }) => { state.entries.push(data); return data; },
    },
    invoice: {
      create: async ({ data }: { data: Record<string, unknown> }) => { state.invoices.push(data); return data; },
      findFirst: async ({ where }: { where: { contractId?: string; id?: string } }) => state.invoices.find((row) => where.id ? row.id === where.id : row.contractId === where.contractId) ?? null,
      findFirstOrThrow: async (args: { where: { id: string } }) => {
        const row = state.invoices.find((item) => item.id === args.where.id);
        if (!row) throw new Error("missing invoice");
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: { amountMinor: number } }) => {
        const row = state.invoices.find((item) => item.id === where.id);
        if (!row) throw new Error("missing invoice");
        row.amountMinor = data.amountMinor;
        return row;
      },
    },
    auditEvent: {
      findFirst: async () => state.audits[state.audits.length - 1] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data); return data; },
    },
    creditRule: { findMany: async () => [] },
    contractCredit: {
      findFirst: async () => null,
      findMany: async () => state.credits.filter((credit) => credit.redeemedAt == null && credit.voidedAt == null),
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const credit = state.credits.find((item) => item.id === where.id && item.redeemedAt == null);
        if (!credit) return { count: 0 };
        Object.assign(credit, data);
        return { count: 1 };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => data,
      update: async ({ data }: { data: Record<string, unknown> }) => data,
    },
  };
  Object.assign(api, {
    proposal: {
      findFirst: async ({ where }: { where: { id: string } }) => where.id === state.proposal.id ? state.proposal : null,
      update: async ({ data }: { data: { status?: string; version?: { increment: number } } }) => {
        if (data.status) state.proposal.status = data.status;
        if (data.version) state.proposal.version += data.version.increment;
        return state.proposal;
      },
    },
  });
  return Object.assign(api, { row: state.proposal, version: state.version });
}
