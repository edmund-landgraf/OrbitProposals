// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { createProposalContractRouter } from "../../server/routes/proposalContract.js";

const usd = "USD";
const organizationId = "55555555-5555-4555-8555-555555555555";

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

type StoredInvoice = { id: string; contractId: string; amountMinor: number; currency: string; status: string };

type StoredContract = {
  id: string;
  proposalId: string;
  organizationId: string;
  status: string;
  terms: string;
  billing: unknown;
  signedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  proposal: { id: string; pricing: unknown };
};

test("concurrent signs insert one schedule, and a unique conflict retries without a second copy", async () => {
  const contracts = new Map<string, StoredContract>();
  const entries: StoredEntry[] = [];
  const invoices: StoredInvoice[] = [];
  let createManyCalls = 0;
  let releaseHold: () => void = () => {};
  const held = new Promise<void>((resolve) => { releaseHold = resolve; });
  let started: () => void = () => {};
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let pauseNextCreate = true;
  let conflictNextCreate = false;

  const view = (contract: StoredContract) => ({
    ...contract,
    entries: entries.filter((entry) => entry.contractId === contract.id).map((entry) => ({ ...entry })),
    proposal: contract.proposal,
  });
  const missing = () => Object.assign(new Error("not found"), { code: "P2025" });
  let owner: symbol | null = null;
  const waiters: Array<() => void> = [];
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
        if (conflictNextCreate) {
          conflictNextCreate = false;
          const contract = contracts.get(data[0]?.contractId ?? "");
          if (contract) {
            contract.status = "signed";
            contract.signedAt = new Date("2026-04-02T00:00:00.000Z");
          }
          const committed = data.map((entry) => ({ ...entry, id: randomUUID(), milestoneId: null, invoiceId: entry.trigger === "contract_signed" ? randomUUID() : null }));
          entries.push(...committed);
          const upfront = committed.filter((entry) => entry.invoiceId);
          if (upfront.length > 0) invoices.push({ id: upfront[0]?.invoiceId ?? randomUUID(), contractId: data[0]?.contractId ?? "", amountMinor: upfront.reduce((sum, entry) => sum + entry.amountMinor, 0), currency: usd, status: "draft" });
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        if (pauseNextCreate) {
          pauseNextCreate = false;
          started();
          await held;
        }
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
      create: async ({ data }: { data: { contractId: string; amountMinor: number; currency: string; status?: string } }) => {
        const invoice = { id: randomUUID(), contractId: data.contractId, amountMinor: data.amountMinor, currency: data.currency, status: data.status ?? "draft" };
        invoices.push(invoice);
        return invoice;
      },
    },
    $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>): Promise<T> => {
      const id = Symbol();
      const tx = {
        ...db,
        $queryRawUnsafe: async (sql: string) => {
          if (!sql.includes("FOR UPDATE")) return [];
          if (owner === id) return [];
          while (owner) await new Promise<void>((resolve) => waiters.push(resolve));
          owner = id;
          return [];
        },
      };
      try {
        return await callback(tx);
      } finally {
        if (owner === id) {
          owner = null;
          waiters.shift()?.();
        }
      }
    },
  };

  function addContract(pricing: unknown) {
    const id = randomUUID();
    const now = new Date("2026-04-01T00:00:00.000Z");
    contracts.set(id, {
      id,
      proposalId: randomUUID(),
      organizationId,
      status: "draft",
      terms: "Terms",
      billing: pricing,
      signedAt: null,
      createdAt: now,
      updatedAt: now,
      proposal: { id: randomUUID(), pricing },
    });
    return id;
  }

  const app = express();
  app.use(express.json());
  app.use("/api/v1", createProposalContractRouter({
    prisma: db as never,
    authorize: async () => ({ userId: randomUUID(), organizationId, role: "client" }),
  }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const origin = `http://127.0.0.1:${address.port}`;
  const sign = async (id: string) => {
    const response = await fetch(`${origin}/api/v1/contracts/${id}/sign`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { status: response.status, body: await response.json() as { ok: boolean; changed?: boolean; code?: string; entity?: { entries: Array<{ label: string; trigger: string }> } } };
  };

  try {
    const concurrentId = addContract({ model: "fixed_price", amountMinor: 300_000, currency: usd });
    const first = sign(concurrentId);
    await startedPromise;
    const second = sign(concurrentId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseHold();
    const responses = await Promise.race([
      Promise.all([first, second]),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("contract sign lock timed out")), 2000)),
    ]);
    assert.equal(createManyCalls, 1);
    assert.equal(entries.filter((entry) => entry.contractId === concurrentId).length, 2);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.equal(responses.filter((response) => response.body.changed).length, 1);
    assert.deepEqual(responses[0]?.body.entity?.entries.map((entry) => entry.trigger), ["contract_signed", "milestone_accepted"]);
    const concurrentEntries = entries.filter((entry) => entry.contractId === concurrentId);
    assert.equal(invoices.filter((invoice) => invoice.contractId === concurrentId).length, 1);
    assert.equal(invoices.find((invoice) => invoice.contractId === concurrentId)?.amountMinor, 150_000);
    assert.equal(concurrentEntries.find((entry) => entry.trigger === "contract_signed")?.invoiceId, invoices.find((invoice) => invoice.contractId === concurrentId)?.id);
    assert.equal(concurrentEntries.find((entry) => entry.trigger === "milestone_accepted")?.invoiceId, null);

    const conflictId = addContract({ model: "workflow_check", amountMinor: 25_000, currency: usd });
    conflictNextCreate = true;
    const before = entries.length;
    const conflicted = await sign(conflictId);
    assert.equal(conflicted.status, 200);
    assert.equal(conflicted.body.ok, true);
    assert.equal(conflicted.body.changed, false);
    assert.equal(entries.filter((entry) => entry.contractId === conflictId).length, 1);
    assert.equal(entries.length, before + 1);
    assert.equal(contracts.get(conflictId)?.status, "signed");
    assert.equal(invoices.filter((invoice) => invoice.contractId === conflictId).length, 1);
    assert.equal(invoices.find((invoice) => invoice.contractId === conflictId)?.amountMinor, 25_000);
  } finally {
    releaseHold();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
