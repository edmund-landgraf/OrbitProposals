// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://appuser:test@127.0.0.1:5432/unwhelm_local";

const { createBillingProjectsRouter } = await import("../../server/routes/billingProjects.js");

const organizationId = randomUUID();
const userId = randomUUID();
const contractId = randomUUID();
const invoiceId = randomUUID();
const projectId = randomUUID();
const milestoneId = randomUUID();

const dates = { createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z") };
const contract = { id: contractId, organizationId, billing: { total: { amountMinor: 10000, currency: "USD" } } };
let invoice = { id: invoiceId, contractId, amountMinor: 10000, currency: "USD", status: "draft", dueDate: new Date("2026-02-01T00:00:00.000Z"), paidAt: null as Date | null, createdAt: dates.createdAt };
let project = { id: projectId, contractId, organizationId, title: "Initial project", status: "planned", ...dates };
let milestone = { id: milestoneId, projectId, title: "First milestone", description: "Design", dueDate: new Date("2026-03-01T00:00:00.000Z"), status: "planned", retainageMinor: null as number | null, retainageCurrency: null as string | null };

const entries = [{ id: randomUUID(), label: "Deposit", percent: { toString: () => "100" }, amountMinor: 10000, currency: "USD", dueOn: null, trigger: "manual", invoiceId: null }];

const db = {
  invoice: {
    findMany: async () => [invoice],
    count: async () => 1,
    findFirst: async () => invoice,
    create: async ({ data }: { data: typeof invoice }) => { invoice = { ...invoice, ...data, id: invoiceId, status: "draft", paidAt: null }; return invoice; },
    update: async ({ data }: { data: Partial<typeof invoice> }) => { invoice = { ...invoice, ...data }; return invoice; },
  },
  contract: {
    findFirst: async () => ({ ...contract, entries }),
  },
  billingEntry: {
    count: async () => 1,
    updateMany: async () => ({ count: 1 }),
  },
  project: {
    findMany: async () => [{ ...project, milestones: [milestone] }],
    count: async () => 1,
    findFirst: async () => ({ ...project, milestones: [milestone] }),
    create: async ({ data }: { data: Partial<typeof project> }) => { project = { ...project, ...data, id: projectId, ...dates } as typeof project; return { ...project, milestones: [] }; },
    update: async ({ data }: { data: Partial<typeof project> }) => { project = { ...project, ...data }; return { ...project, milestones: [milestone] }; },
  },
  milestone: {
    findMany: async () => [milestone],
    count: async () => 1,
    findFirst: async () => milestone,
    create: async ({ data }: { data: Partial<typeof milestone> }) => { milestone = { ...milestone, ...data, id: milestoneId } as typeof milestone; return milestone; },
    update: async ({ data }: { data: Partial<typeof milestone> }) => { milestone = { ...milestone, ...data }; return milestone; },
  },
  changeOrder: {
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: randomUUID(), ...data, status: "pending" }),
  },
  $transaction: async <T>(callback: (transaction: typeof db) => Promise<T>) => callback(db),
} as never;

const app = express();
app.use(express.json());
app.use("/api/v1", createBillingProjectsRouter({
  prisma: db,
  authorize: () => ({ userId, organizationId, role: "staff", scopes: ["billing:read", "billing:write", "change_orders:write", "projects:read", "projects:write"] }),
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

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/api/v1${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

test("implements invoice list/create/get and billing schedule", async () => {
  assert.equal((await call("/invoices")).status, 200);
  const created = await call("/invoices", { method: "POST", body: JSON.stringify({ contractId, amount: { amountMinor: 10000, currency: "USD" }, dueDate: "2026-02-01" }) });
  assert.equal(created.status, 201);
  assert.equal((await call(`/invoices/${invoiceId}`)).status, 200);
  const schedule = await call(`/contracts/${contractId}/billing`);
  assert.equal(schedule.status, 200);
  assert.equal((schedule.body.entity as { total: { amountMinor: number } }).total.amountMinor, 10000);
});

test("implements invoice send/pay/void transitions", async () => {
  assert.equal((await call(`/invoices/${invoiceId}/send`, { method: "POST", body: "{}" })).status, 200);
  assert.equal((await call(`/invoices/${invoiceId}/pay`, { method: "POST", body: "{}" })).status, 200);
  assert.equal((await call(`/invoices/${invoiceId}/void`, { method: "POST", body: "{}" })).status, 409);
});

test("implements change orders and project/milestone operations", async () => {
  assert.equal((await call("/change-orders", { method: "POST", body: JSON.stringify({ contractId, summary: "Add review", priceDelta: null }) })).status, 201);
  assert.equal((await call("/projects")).status, 200);
  assert.equal((await call("/projects", { method: "POST", body: JSON.stringify({ contractId, title: "Delivery" }) })).status, 201);
  assert.equal((await call(`/projects/${projectId}`)).status, 200);
  assert.equal((await call(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) })).status, 200);
  assert.equal((await call(`/projects/${projectId}/milestones`)).status, 200);
  assert.equal((await call(`/projects/${projectId}/milestones`, { method: "POST", body: JSON.stringify({ title: "Launch", description: "Ship it" }) })).status, 201);
  assert.equal((await call(`/milestones/${milestoneId}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) })).status, 200);
});

test("uses the common auth and validation envelopes", async () => {
  const unauthenticated = express();
  unauthenticated.use(express.json());
  unauthenticated.use("/api/v1", createBillingProjectsRouter({ prisma: db, authorize: () => null }));
  const temporary = createServer(unauthenticated);
  await new Promise<void>((resolve) => temporary.listen(0, "127.0.0.1", () => resolve()));
  const address = temporary.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/invoices`);
  const body = await response.json() as { ok: boolean; code: string; requestId: string };
  assert.equal(response.status, 401);
  assert.deepEqual({ ok: body.ok, code: body.code, requestIdIsUuid: UUID(body.requestId) }, { ok: false, code: "AUTH_REQUIRED", requestIdIsUuid: true });
  await new Promise<void>((resolve, reject) => temporary.close((error) => error ? reject(error) : resolve()));
});

function UUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

