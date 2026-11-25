// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  BILLING_SCHEDULE_DEFAULTS,
  BillingScheduleError,
  BillingScheduleSchema,
  billingScheduleFromPricing,
  contractSignedInvoiceAmount,
  formatBillingPercent,
  milestoneAcceptanceInvoiceAmount,
  milestoneThatOwnsUnscopedEntries,
  reconcileBillingSchedule,
} from "../../packages/shapes/src/index.js";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

const usd = "USD";

test("documents a default billing schedule for every pricing model", () => {
  assert.match(BILLING_SCHEDULE_DEFAULTS.workflow_check, /100%/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.workflow_check, /contract is signed/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.capped_hours, /100%/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.capped_hours, /contract is signed/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.fixed_price, /50\/50/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.fixed_price, /milestone is accepted/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.fixed_price, /leftover cent/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.fixed_price, /final milestone/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.hourly, /per invoice/);
  assert.match(BILLING_SCHEDULE_DEFAULTS.hourly, /not a prepaid balance/);
  assert.equal(formatBillingPercent("100"), "100.0000");
  assert.equal(formatBillingPercent("50"), "50.0000");
  assert.equal(formatBillingPercent("50.5"), "50.5000");
});

test("builds an upfront schedule for workflow check and both capped hour tiers", () => {
  const workflow = billingScheduleFromPricing({ model: "workflow_check", amountMinor: 25_000, currency: usd });
  assert.deepEqual(workflow, {
    total: { amountMinor: 25_000, currency: usd },
    entries: [{ label: "Workflow Check", percent: "100.0000", amountMinor: 25_000, currency: usd, dueOn: null, trigger: "contract_signed" }],
  });

  const four = billingScheduleFromPricing({ model: "capped_hours", hours: 4, amountMinor: 55_000, currency: usd });
  assert.equal(four.entries[0]?.label, "Capped Hours, 4 hours");
  assert.equal(four.entries[0]?.trigger, "contract_signed");
  assert.equal(four.entries[0]?.percent, "100.0000");
  assert.equal(four.total.amountMinor, 55_000);
  assert.equal(four.entries[0]?.amountMinor, 55_000);

  const eight = billingScheduleFromPricing({ model: "capped_hours", hours: 8, amountMinor: 90_000, currency: usd });
  assert.equal(eight.entries[0]?.label, "Capped Hours, 8 hours");
  assert.equal(eight.entries[0]?.amountMinor, 90_000);
  assert.equal(eight.entries[0]?.trigger, "contract_signed");
  reconcileBillingSchedule(workflow);
  reconcileBillingSchedule(four);
  reconcileBillingSchedule(eight);
});

test("splits fixed price 50/50 and gives a leftover cent to milestone acceptance", () => {
  const even = billingScheduleFromPricing({ model: "fixed_price", amountMinor: 300_000, currency: usd });
  assert.deepEqual(even.entries.map((entry) => ({ label: entry.label, percent: entry.percent, amountMinor: entry.amountMinor, trigger: entry.trigger })), [
    { label: "Deposit", percent: "50.0000", amountMinor: 150_000, trigger: "contract_signed" },
    { label: "Milestone acceptance", percent: "50.0000", amountMinor: 150_000, trigger: "milestone_accepted" },
  ]);

  const odd = billingScheduleFromPricing({ model: "fixed_price", amountMinor: 300_001, currency: usd });
  assert.deepEqual(odd.entries.map((entry) => entry.amountMinor), [150_000, 150_001]);
  assert.equal(odd.entries[0]?.percent, "50.0000");
  assert.equal(odd.entries[1]?.percent, "50.0000");
  reconcileBillingSchedule(even);
  reconcileBillingSchedule(odd);
});

test("uses a manual zero-amount schedule for hourly work", () => {
  const hourly = billingScheduleFromPricing({ model: "hourly", rateMinor: 17_500, currency: usd });
  assert.equal(hourly.total.amountMinor, 0);
  assert.equal(hourly.entries.length, 1);
  assert.equal(hourly.entries[0]?.trigger, "manual");
  assert.equal(hourly.entries[0]?.percent, "100.0000");
  assert.equal(hourly.entries[0]?.amountMinor, 0);
  assert.match(hourly.entries[0]?.label ?? "", /\$175\/hr/);
  assert.match(hourly.entries[0]?.label ?? "", /per invoice/);
  reconcileBillingSchedule(hourly);
});

test("releases retainage onto the milestone balance and rejects a mixed currency", () => {
  assert.deepEqual(milestoneAcceptanceInvoiceAmount({
    entries: [{ amountMinor: 150_001, currency: usd }],
    retainage: { amountMinor: 5_000, currency: usd },
  }), { amountMinor: 155_001, currency: usd });
  assert.deepEqual(milestoneAcceptanceInvoiceAmount({
    entries: [{ amountMinor: 150_000, currency: usd }],
    retainage: null,
  }), { amountMinor: 150_000, currency: usd });
  assert.equal(milestoneAcceptanceInvoiceAmount({ entries: [], retainage: null }), null);
  assert.equal(milestoneAcceptanceInvoiceAmount({ entries: [], retainage: { amountMinor: 0, currency: usd } }), null);
  assert.throws(() => milestoneAcceptanceInvoiceAmount({
    entries: [{ amountMinor: 150_000, currency: usd }],
    retainage: { amountMinor: 5_000, currency: "EUR" },
  }), BillingScheduleError);
});

test("prices the contract-signed draft and assigns an unscoped remainder to the final milestone", () => {
  assert.deepEqual(contractSignedInvoiceAmount([
    { amountMinor: 25_000, currency: usd },
  ]), { amountMinor: 25_000, currency: usd });
  assert.deepEqual(contractSignedInvoiceAmount([
    { amountMinor: 55_000, currency: usd },
    { amountMinor: 0, currency: usd },
  ]), { amountMinor: 55_000, currency: usd });
  assert.equal(contractSignedInvoiceAmount([]), null);
  assert.equal(contractSignedInvoiceAmount([{ amountMinor: 0, currency: usd }]), null);
  const early = "00000000-0000-4000-8000-000000000001";
  const later = "00000000-0000-4000-8000-000000000002";
  const undated = "00000000-0000-4000-8000-000000000003";
  assert.equal(milestoneThatOwnsUnscopedEntries([{ id: early, dueDate: null }]), early);
  assert.equal(milestoneThatOwnsUnscopedEntries([
    { id: early, dueDate: new Date("2026-05-01T00:00:00.000Z") },
    { id: later, dueDate: new Date("2026-08-01T00:00:00.000Z") },
    { id: undated, dueDate: null },
  ]), later);
  assert.equal(milestoneThatOwnsUnscopedEntries([
    { id: early, dueDate: null },
    { id: later, dueDate: null },
  ]), later);
});

test("rejects pricing that is not the single published model", () => {
  assert.throws(() => billingScheduleFromPricing({ model: "fixed_price", amountMinor: 299_999, currency: usd }), BillingScheduleError);
  assert.throws(() => billingScheduleFromPricing({ model: "hourly", amountMinor: 17_500, currency: usd }), BillingScheduleError);
  assert.throws(() => billingScheduleFromPricing({ model: "workflow_check", amountMinor: 25_000, currency: usd, extra: true }), BillingScheduleError);
});

type StoredEntry = {
  id: string;
  contractId: string;
  label: string;
  percent: string;
  amountMinor: number;
  currency: string;
  dueOn: null;
  trigger: string;
  milestoneId: string | null;
  invoiceId: string | null;
};

type StoredInvoice = { id: string; contractId: string; amountMinor: number; currency: string; status: string; dueDate: Date };

type StoredContract = {
  id: string;
  proposalId: string;
  organizationId: string;
  status: string;
  terms: string;
  billing: unknown;
  pricing?: unknown;
  signedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  proposal: { id: string; pricing: unknown };
};

const organizationId = "55555555-5555-4555-8555-555555555555";
const contracts = new Map<string, StoredContract>();
const entries: StoredEntry[] = [];
const invoices: StoredInvoice[] = [];
let createManyCalls = 0;

const missing = () => Object.assign(new Error("not found"), { code: "P2025" });

function view(contract: StoredContract) {
  return {
    ...contract,
    entries: entries.filter((entry) => entry.contractId === contract.id).map((entry) => ({ ...entry })),
    proposal: contract.proposal,
  };
}

const db = {
  contract: {
    findFirstOrThrow: async ({ where }: { where: { id: string; organizationId?: string } }) => {
      const contract = contracts.get(where.id);
      if (!contract || (where.organizationId && contract.organizationId !== where.organizationId)) throw missing();
      return view(contract);
    },
    update: async ({ where, data }: { where: { id: string }; data: { status?: string; signedAt?: Date; billing?: unknown } }) => {
      const contract = contracts.get(where.id);
      if (!contract) throw missing();
      if (data.status) contract.status = data.status;
      if (data.signedAt instanceof Date) contract.signedAt = data.signedAt;
      if (data.billing !== undefined) contract.billing = data.billing;
      contract.updatedAt = new Date();
      return view(contract);
    },
  },
  billingEntry: {
    createMany: async ({ data }: { data: StoredEntry[] }) => {
      createManyCalls += 1;
      entries.push(...data.map((entry) => ({ ...entry, milestoneId: entry.milestoneId ?? null })));
      return { count: data.length };
    },
    updateMany: async ({ where, data }: { where: { id: { in: string[] }; invoiceId: null }; data: { invoiceId: string } }) => {
      let count = 0;
      for (const entry of entries) {
        if (!where.id.in.includes(entry.id) || entry.invoiceId !== null) continue;
        entry.invoiceId = data.invoiceId;
        count += 1;
      }
      return { count };
    },
  },
  invoice: {
    create: async ({ data }: { data: { contractId: string; amountMinor: number; currency: string; dueDate: Date; status?: string } }) => {
      const invoice = { id: randomUUID(), contractId: data.contractId, amountMinor: data.amountMinor, currency: data.currency, status: data.status ?? "draft", dueDate: data.dueDate };
      invoices.push(invoice);
      return invoice;
    },
  },
  $queryRawUnsafe: async () => [],
  $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback(db),
};

function addContract(pricing: unknown, status = "draft", organization = organizationId) {
  return addContractWithTerms({ proposalPricing: pricing, contractPricing: undefined, status, organization });
}

function addContractWithTerms(input: { proposalPricing: unknown; contractPricing?: unknown; status?: string; organization?: string }) {
  const id = randomUUID();
  const now = new Date("2026-04-01T00:00:00.000Z");
  contracts.set(id, {
    id,
    proposalId: randomUUID(),
    organizationId: input.organization ?? organizationId,
    status: input.status ?? "draft",
    terms: "Terms",
    billing: input.proposalPricing,
    pricing: input.contractPricing,
    signedAt: null,
    createdAt: now,
    updatedAt: now,
    proposal: { id: randomUUID(), pricing: input.proposalPricing },
  });
  return id;
}

const app = express();
app.use(express.json());
app.use("/api/v1", createProposalContractRouter({
  prisma: db as never,
  authorize: async () => ({ userId: randomUUID(), organizationId, role: "client" }),
}));

let server: Server;
let origin: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

async function sign(id: string) {
  const response = await fetch(`${origin}/api/v1/contracts/${id}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  return { status: response.status, body: await response.json() as { ok: boolean; changed?: boolean; code?: string; links?: { invoice?: string }; entity?: SignedEntity } };
}

type SignedEntity = {
  status: string;
  signedAt: string | null;
  billing: { total: { amountMinor: number; currency: string }; entries: unknown[] };
  entries: Array<{ id: string; label: string; percent: string; amountMinor: number; currency: string; dueOn: string | null; trigger: string; milestoneId: string | null; invoiceId: string | null }>;
};

async function signTwice(pricing: unknown) {
  const id = addContract(pricing);
  const beforeCalls = createManyCalls;
  const beforeInvoices = invoices.length;
  const first = await sign(id);
  const second = await sign(id);
  assert.equal(first.status, 200);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.changed, true);
  assert.equal(second.status, 200);
  assert.equal(second.body.changed, false);
  assert.equal(createManyCalls, beforeCalls + 1);
  assert.equal(second.body.entity?.signedAt, first.body.entity?.signedAt);
  assert.deepEqual(second.body.entity?.entries.map((entry) => entry.id), first.body.entity?.entries.map((entry) => entry.id));
  const entity = first.body.entity;
  if (!entity) throw new Error("signed contract missing");
  BillingScheduleSchema.parse(entity.billing);
  reconcileBillingSchedule({
    total: entity.billing.total,
    entries: entity.entries.map((entry) => ({ percent: entry.percent, amountMinor: entry.amountMinor, currency: entry.currency })),
  });
  assert.equal(contracts.get(id)?.status, "signed");
  const upfront = entity.entries.filter((entry) => entry.trigger === "contract_signed" && entry.amountMinor > 0);
  assert.equal(invoices.length, beforeInvoices + (upfront.length > 0 ? 1 : 0));
  if (upfront.length > 0) assert.equal(first.body.links?.invoice, `/api/v1/invoices/${upfront[0]?.invoiceId}`);
  return entity;
}

test("signing generates each pricing model's schedule once", async () => {
  const workflow = await signTwice({ model: "workflow_check", amountMinor: 25_000, currency: usd });
  assert.deepEqual(workflow.entries.map((entry) => [entry.label, entry.percent, entry.amountMinor, entry.trigger]), [
    ["Workflow Check", "100.0000", 25_000, "contract_signed"],
  ]);

  const four = await signTwice({ model: "capped_hours", hours: 4, amountMinor: 55_000, currency: usd });
  assert.equal(four.entries[0]?.label, "Capped Hours, 4 hours");
  assert.equal(four.entries[0]?.amountMinor, 55_000);
  assert.equal(four.entries[0]?.trigger, "contract_signed");

  const eight = await signTwice({ model: "capped_hours", hours: 8, amountMinor: 90_000, currency: usd });
  assert.equal(eight.entries[0]?.label, "Capped Hours, 8 hours");
  assert.equal(eight.entries[0]?.amountMinor, 90_000);

  const fixed = await signTwice({ model: "fixed_price", amountMinor: 450_000, currency: usd });
  assert.deepEqual(fixed.entries.map((entry) => [entry.label, entry.percent, entry.amountMinor, entry.trigger]), [
    ["Deposit", "50.0000", 225_000, "contract_signed"],
    ["Milestone acceptance", "50.0000", 225_000, "milestone_accepted"],
  ]);

  const odd = await signTwice({ model: "fixed_price", amountMinor: 300_001, currency: usd });
  assert.deepEqual(odd.entries.map((entry) => entry.amountMinor), [150_000, 150_001]);

  const hourly = await signTwice({ model: "hourly", rateMinor: 17_500, currency: usd });
  assert.equal(hourly.billing.total.amountMinor, 0);
  assert.equal(hourly.entries[0]?.trigger, "manual");
  assert.equal(hourly.entries[0]?.amountMinor, 0);
  assert.equal(hourly.entries[0]?.percent, "100.0000");
  assert.match(hourly.entries[0]?.label ?? "", /\$175\/hr/);
  for (const entity of [workflow, four, eight, fixed, odd, hourly]) {
    for (const entry of entity.entries) {
      assert.equal(entry.currency, usd);
      assert.equal(entry.dueOn, null);
      assert.equal(entry.milestoneId, null);
      if (entry.trigger === "contract_signed" && entry.amountMinor > 0) assert.ok(entry.invoiceId);
      else assert.equal(entry.invoiceId, null);
    }
  }
  assert.equal(workflow.entries[0]?.invoiceId, invoices.find((invoice) => invoice.amountMinor === 25_000)?.id);
  assert.equal(four.entries[0]?.invoiceId, invoices.find((invoice) => invoice.amountMinor === 55_000)?.id);
  assert.equal(eight.entries[0]?.invoiceId, invoices.find((invoice) => invoice.amountMinor === 90_000)?.id);
  assert.equal(fixed.entries[0]?.invoiceId, invoices.find((invoice) => invoice.amountMinor === 225_000)?.id);
  assert.equal(fixed.entries[1]?.invoiceId, null);
  assert.equal(odd.entries[0]?.invoiceId, invoices.find((invoice) => invoice.amountMinor === 150_000)?.id);
  assert.equal(hourly.entries[0]?.invoiceId, null);
  assert.equal(invoices.filter((invoice) => invoice.status === "draft").length, invoices.length);
});

test("signing keeps an existing schedule and still records the signature", async () => {
  const id = addContract({ model: "fixed_price", amountMinor: 300_000, currency: usd });
  const contract = contracts.get(id);
  if (!contract) throw new Error("missing contract");
  entries.push({ id: randomUUID(), contractId: id, label: "Custom deposit", percent: "100.0000", amountMinor: 300_000, currency: usd, dueOn: null, trigger: "manual", milestoneId: null, invoiceId: null });
  const beforeCalls = createManyCalls;
  const signed = await sign(id);
  assert.equal(signed.status, 200);
  assert.equal(signed.body.changed, true);
  assert.equal(createManyCalls, beforeCalls);
  assert.deepEqual(signed.body.entity?.entries.map((entry) => entry.label), ["Custom deposit"]);
  assert.equal(contracts.get(id)?.billing, contract.proposal.pricing);
});

test("signing rejects a cancelled contract and invalid pricing without writing entries", async () => {
  const cancelled = addContract({ model: "workflow_check", amountMinor: 25_000, currency: usd }, "cancelled");
  const cancelledResult = await sign(cancelled);
  assert.equal(cancelledResult.status, 409);
  assert.equal(cancelledResult.body.code, "CONFLICT");
  assert.equal(entries.some((entry) => entry.contractId === cancelled), false);

  const invalid = addContract({ model: "fixed_price", amountMinor: 100, currency: usd });
  const beforeCalls = createManyCalls;
  const invalidResult = await sign(invalid);
  assert.equal(invalidResult.status, 400);
  assert.equal(invalidResult.body.code, "VALIDATION_FAILED");
  assert.equal(createManyCalls, beforeCalls);
  assert.equal(contracts.get(invalid)?.status, "draft");
  assert.equal(contracts.get(invalid)?.signedAt, null);

  const otherOrg = addContract({ model: "workflow_check", amountMinor: 25_000, currency: usd }, "draft", randomUUID());
  const denied = await sign(otherOrg);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, "FORBIDDEN");
});

test("signing generates schedules from the contract's stored pricing terms when present", async () => {
  const contractPricing = { model: "fixed_price", amountMinor: 450_000, currency: usd };
  const proposalPricing = { model: "fixed_price", amountMinor: 300_000, currency: usd };
  const id = addContractWithTerms({ proposalPricing, contractPricing });
  const signed = await sign(id);
  assert.equal(signed.status, 200);
  assert.equal(signed.body.changed, true);
  const entity = signed.body.entity;
  if (!entity) throw new Error("signed contract missing");
  assert.deepEqual(entity.entries.map((entry) => entry.amountMinor), [225_000, 225_000]);
});
