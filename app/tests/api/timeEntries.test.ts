// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { createTimeEntriesRouter } from "../../server/routes/timeEntries.js";

const organizationId = "55555555-5555-4555-8555-555555555555";
const userId = "22222222-2222-4222-8222-222222222222";

type Entry = {
  id: string;
  contractId: string;
  userId: string;
  date: Date;
  hours: Prisma.Decimal;
  description: string;
  billable: boolean;
  invoiceId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Invoice = {
  id: string;
  contractId: string;
  amountMinor: number;
  currency: string;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  createdAt: Date;
};

function hoursMatch(entry: Entry, where: { contractId?: string; id?: string | { not: string }; invoiceId?: null; billable?: boolean; date?: { gte: Date; lte: Date } }): boolean {
  if (where.contractId && entry.contractId !== where.contractId) return false;
  if (typeof where.id === "string" && entry.id !== where.id) return false;
  if (where.id && typeof where.id === "object" && "not" in where.id && entry.id === where.id.not) return false;
  if (where.invoiceId === null && entry.invoiceId !== null) return false;
  if (where.billable != null && entry.billable !== where.billable) return false;
  if (where.date && (entry.date < where.date.gte || entry.date > where.date.lte)) return false;
  return true;
}

function store(pricing: unknown) {
  const contractId = randomUUID();
  const entries: Entry[] = [];
  const invoices: Invoice[] = [];
  const contract = {
    id: contractId,
    organizationId,
    catalogVersionId: null as string | null,
    proposal: { pricing, catalogVersionId: null as string | null },
  };
  const timeEntry = {
    findMany: async ({ where }: { where: Parameters<typeof hoursMatch>[1] }) => entries.filter((entry) => hoursMatch(entry, where)),
    findFirst: async ({ where }: { where: { id: string; contract?: { organizationId: string } } }) => {
      const entry = entries.find((item) => item.id === where.id);
      if (!entry) return null;
      if (where.contract && contract.organizationId !== where.contract.organizationId) return null;
      return { ...entry, contract };
    },
    create: async ({ data }: { data: Omit<Entry, "id" | "invoiceId" | "createdAt" | "updatedAt"> }) => {
      const now = new Date();
      const created: Entry = { ...data, id: randomUUID(), invoiceId: null, createdAt: now, updatedAt: now };
      entries.push(created);
      return created;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Entry> }) => {
      const entry = entries.find((item) => item.id === where.id);
      if (!entry) throw new Error("missing");
      Object.assign(entry, data, { updatedAt: new Date() });
      return entry;
    },
    updateMany: async ({ where, data }: { where: { id: { in: string[] }; invoiceId: null }; data: { invoiceId: string } }) => {
      let count = 0;
      for (const entry of entries) {
        if (where.id.in.includes(entry.id) && entry.invoiceId === null) {
          entry.invoiceId = data.invoiceId;
          count += 1;
        }
      }
      return { count };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = entries.findIndex((item) => item.id === where.id);
      if (index < 0) throw new Error("missing");
      entries.splice(index, 1);
    },
  };
  const db = {
    contract: { findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => where.id === contract.id && where.organizationId === contract.organizationId ? contract : null },
    timeEntry,
    invoice: {
      create: async ({ data }: { data: Omit<Invoice, "id" | "paidAt" | "createdAt"> }) => {
        const created: Invoice = { ...data, id: randomUUID(), paidAt: null, createdAt: new Date() };
        invoices.push(created);
        return created;
      },
    },
    $queryRaw: async () => [],
    $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
  };
  return { db, contractId, entries, invoices, contract };
}

async function listen(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

function appFor(db: object) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createTimeEntriesRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "staff", scopes: ["billing:write", "billing:read"] }),
  }));
  return app;
}

async function call(origin: string, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() as { ok: boolean; code?: string; message?: string; entity: Record<string, unknown> } };
}

test("a capped-hours contract rejects an entry past the catalog cap and invoices the implied tier rate", async () => {
  const { db, contractId, entries, invoices } = store({ model: "capped_hours", hours: 4, amountMinor: 55000, currency: "USD" });
  const server = await listen(appFor(db));
  try {
    const first = await call(server.origin, `/contracts/${contractId}/time-entries`, "POST", { date: "2026-06-01", hours: 3, description: "Mapping" });
    assert.equal(first.status, 201);
    assert.equal(first.body.entity.remainingHours, 1);

    const remaining = await call(server.origin, `/contracts/${contractId}/hours-remaining`);
    assert.equal(remaining.status, 200);
    assert.equal(remaining.body.entity.capHours, 4);
    assert.equal(remaining.body.entity.loggedHours, 3);
    assert.equal(remaining.body.entity.remainingHours, 1);
    assert.deepEqual(remaining.body.entity.rate, { amountMinor: 13750, currency: "USD" });

    const over = await call(server.origin, `/contracts/${contractId}/time-entries`, "POST", { date: "2026-06-02", hours: 2, description: "Over the cap" });
    assert.equal(over.status, 409);
    assert.equal(over.body.code, "HOUR_CAP_EXCEEDED");
    assert.match(over.body.message ?? "", /hour cap of 4 hours/);
    assert.equal(entries.length, 1);

    const second = await call(server.origin, `/contracts/${contractId}/time-entries`, "POST", { date: "2026-06-02", hours: 1, description: "Closeout", billable: true });
    assert.equal(second.status, 201);

    const nonBillable = await call(server.origin, `/contracts/${contractId}/time-entries`, "POST", { date: "2026-06-03", hours: 0.5, description: "Notes", billable: false });
    assert.equal(nonBillable.status, 409);

    const invoiced = await call(server.origin, `/contracts/${contractId}/invoice-hours`, "POST", { from: "2026-06-01", to: "2026-06-02" });
    assert.equal(invoiced.status, 201);
    assert.equal(invoiced.body.entity.status, "draft");
    assert.deepEqual(invoiced.body.entity.amount, { amountMinor: 55000, currency: "USD" });
    assert.equal(invoiced.body.entity.hours, 4);
    assert.equal(invoices.length, 1);
    assert.equal(entries.filter((entry) => entry.invoiceId === invoices[0]?.id).length, 2);

    const again = await call(server.origin, `/contracts/${contractId}/invoice-hours`, "POST", { from: "2026-06-01", to: "2026-06-02" });
    assert.equal(again.status, 409);
    assert.match(again.body.message ?? "", /No unbilled billable hours/);
    assert.equal(invoices.length, 1);
  } finally {
    await server.close();
  }
});

test("hourly invoices use the catalog hourly rate and leave a null cap", async () => {
  const { db, contractId, entries } = store({ model: "hourly", rateMinor: 17500, currency: "USD" });
  const server = await listen(appFor(db));
  try {
    const remaining = await call(server.origin, `/contracts/${contractId}/hours-remaining`);
    assert.equal(remaining.body.entity.capHours, null);
    assert.equal(remaining.body.entity.remainingHours, null);
    assert.deepEqual(remaining.body.entity.rate, { amountMinor: 17500, currency: "USD" });

    const logged = await call(server.origin, `/contracts/${contractId}/time-entries`, "POST", { date: "2026-07-01", hours: 2.5, description: "Support" });
    assert.equal(logged.status, 201);
    assert.equal(logged.body.entity.userId, userId);
    assert.equal(logged.body.entity.remainingHours, null);

    const invoiced = await call(server.origin, `/contracts/${contractId}/invoice-hours`, "POST", { from: "2026-07-01", to: "2026-07-01" });
    assert.equal(invoiced.status, 201);
    assert.equal((invoiced.body.entity.amount as { amountMinor: number }).amountMinor, 43750);
    assert.equal(entries[0]?.invoiceId, invoiced.body.entity.id);

    const changed = await call(server.origin, `/time-entries/${entries[0]?.id}`, "PATCH", { hours: 1 });
    assert.equal(changed.status, 409);
    assert.match(changed.body.message ?? "", /cannot be changed/);
  } finally {
    await server.close();
  }
});
