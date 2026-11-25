// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import { createServer, type Server } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { billingScheduleFromPricing } from "../../packages/shapes/src/index.js";
import { createBillingProjectsRouter } from "../../server/routes/billingProjects.js";

const usd = "USD";
const organizationId = "55555555-5555-4555-8555-555555555555";
const userId = "22222222-2222-4222-8222-222222222222";

type Entry = {
  id: string;
  contractId: string;
  label: string;
  amountMinor: number;
  currency: string;
  trigger: string;
  milestoneId?: string | null;
  invoiceId: string | null;
};
type Milestone = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: Date | null;
  status: string;
  retainageMinor: number | null;
  retainageCurrency: string | null;
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
type Token = {
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  userId: string;
  scopes: string[];
  client: { organizationId: string | null };
  user: { memberships: Array<{ status: string; role: "prospect" | "client" | "staff"; organizationId: string }> };
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function matchesEntry(entry: Entry, where: { contractId?: string; trigger?: string; invoiceId?: null | { not: null } }): boolean {
  if (where.contractId && entry.contractId !== where.contractId) return false;
  if (where.trigger && entry.trigger !== where.trigger) return false;
  if (where.invoiceId === null && entry.invoiceId !== null) return false;
  if (where.invoiceId && typeof where.invoiceId === "object" && "not" in where.invoiceId && entry.invoiceId === null) return false;
  return true;
}

async function listen(app: express.Express): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("accepting a milestone invoices the fixed-price balance, releases retainage, and does not repeat", async () => {
  const contractId = randomUUID();
  const projectId = randomUUID();
  const milestoneId = randomUUID();
  const schedule = billingScheduleFromPricing({ model: "fixed_price", amountMinor: 300_001, currency: usd });
  const deposit = schedule.entries[0];
  const balance = schedule.entries[1];
  if (!deposit || !balance) throw new Error("fixed-price schedule missing entries");
  const entries: Entry[] = [
    { id: randomUUID(), contractId, label: deposit.label, amountMinor: deposit.amountMinor, currency: usd, trigger: deposit.trigger, invoiceId: null },
    { id: randomUUID(), contractId, label: balance.label, amountMinor: balance.amountMinor, currency: usd, trigger: balance.trigger, invoiceId: null },
  ];
  const milestone: Milestone = {
    id: milestoneId,
    projectId,
    title: "Launch",
    description: "Ship the fixed-price remainder",
    dueDate: new Date("2026-06-01T00:00:00.000Z"),
    status: "submitted",
    retainageMinor: 5_000,
    retainageCurrency: usd,
  };
  const project = { id: projectId, contractId, organizationId };
  const invoices: Invoice[] = [];
  const db = store({ entries, milestones: [milestone], projects: [project], invoices, contracts: [{ id: contractId, organizationId }] });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "staff", scopes: ["projects:write", "billing:write", "billing:read"] }),
  }));
  const server = await listen(app);
  try {
    milestone.status = "planned";
    const early = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(early.status, 409);
    assert.equal(early.body.code, "CONFLICT");
    assert.equal(invoices.length, 0);

    milestone.status = "submitted";
    const accepted = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ok, true);
    assert.equal(accepted.body.changed, true);
    assert.equal((accepted.body.entity as { status: string }).status, "accepted");
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.amountMinor, balance.amountMinor + 5_000);
    assert.equal(invoices[0]?.amountMinor, 155_001);
    assert.equal(invoices[0]?.currency, usd);
    assert.equal(invoices[0]?.status, "draft");
    assert.equal(invoices[0]?.dueDate.toISOString().slice(0, 10), "2026-06-01");
    assert.equal(entries[1]?.invoiceId, invoices[0]?.id);
    assert.equal(entries[0]?.invoiceId, null);
    assert.equal((accepted.body.links as { invoice?: string }).invoice, `/api/v1/invoices/${invoices[0]?.id}`);

    const again = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false);
    assert.equal(invoices.length, 1);
    assert.equal((again.body.links as { invoice?: string }).invoice, `/api/v1/invoices/${invoices[0]?.id}`);

    const missing = await call(server.origin, `/milestones/${randomUUID()}/accept`);
    assert.equal(missing.status, 404);
    project.organizationId = randomUUID();
    milestone.status = "submitted";
    const hidden = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(hidden.status, 403);
    assert.equal(hidden.body.code, "FORBIDDEN");
  } finally {
    await server.close();
  }
});

test("a retainage currency mismatch does not accept the milestone or create an invoice", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const entries: Entry[] = [{ id: randomUUID(), contractId, label: "Milestone acceptance", amountMinor: 150_000, currency: usd, trigger: "milestone_accepted", invoiceId: null }];
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Launch", description: "", dueDate: null, status: "submitted", retainageMinor: 1_000, retainageCurrency: "EUR",
  };
  const invoices: Invoice[] = [];
  const db = store({ entries, milestones: [milestone], projects: [{ id: milestone.projectId, contractId, organizationId }], invoices, contracts: [{ id: contractId, organizationId }] });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "client", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const response = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_FAILED");
    assert.equal(milestone.status, "submitted");
    assert.equal(invoices.length, 0);
    assert.equal(entries[0]?.invoiceId, null);
  } finally {
    await server.close();
  }
});

test("acceptance with no milestone-triggered entries does not invent an invoice", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const entries: Entry[] = [{ id: randomUUID(), contractId, label: "Workflow Check", amountMinor: 25_000, currency: usd, trigger: "contract_signed", invoiceId: null }];
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Done", description: "", dueDate: null, status: "submitted", retainageMinor: null, retainageCurrency: null,
  };
  const invoices: Invoice[] = [];
  const db = store({ entries, milestones: [milestone], projects: [{ id: milestone.projectId, contractId, organizationId }], invoices, contracts: [{ id: contractId, organizationId }] });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "client", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const response = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(response.status, 200);
    assert.equal(response.body.changed, true);
    assert.equal(milestone.status, "accepted");
    assert.equal(invoices.length, 0);
    assert.equal((response.body.links as { invoice?: string }).invoice, undefined);
    assert.equal(entries[0]?.invoiceId, null);
  } finally {
    await server.close();
  }
});

test("retainage alone is released onto a draft invoice", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Closeout", description: "", dueDate: null, status: "submitted", retainageMinor: 8_000, retainageCurrency: usd,
  };
  const invoices: Invoice[] = [];
  const db = store({ entries: [], milestones: [milestone], projects: [{ id: milestone.projectId, contractId, organizationId }], invoices, contracts: [{ id: contractId, organizationId }] });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "client", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const response = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(response.status, 200);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.amountMinor, 8_000);
    assert.equal(invoices[0]?.status, "draft");
    assert.equal((response.body.links as { invoice?: string }).invoice, `/api/v1/invoices/${invoices[0]?.id}`);
    const again = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(again.body.changed, false);
    assert.equal(invoices.length, 1);
  } finally {
    await server.close();
  }
});

test("concurrent accepts of one milestone create a single draft invoice", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const entries: Entry[] = [{ id: randomUUID(), contractId, label: "Milestone acceptance", amountMinor: 225_000, currency: usd, trigger: "milestone_accepted", invoiceId: null }];
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Launch", description: "", dueDate: new Date("2026-07-01T00:00:00.000Z"), status: "submitted", retainageMinor: null, retainageCurrency: null,
  };
  const invoices: Invoice[] = [];
  let releaseHold: () => void = () => {};
  const held = new Promise<void>((resolve) => { releaseHold = resolve; });
  let started: () => void = () => {};
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  let creates = 0;
  const db = store({
    entries,
    milestones: [milestone],
    projects: [{ id: milestone.projectId, contractId, organizationId }],
    invoices,
    contracts: [{ id: contractId, organizationId }],
    onCreateInvoice: async () => {
      creates += 1;
      if (creates === 1) {
        started();
        await held;
      }
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "staff", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const first = call(server.origin, `/milestones/${milestoneId}/accept`);
    await startedPromise;
    const second = call(server.origin, `/milestones/${milestoneId}/accept`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseHold();
    const responses = await Promise.race([
      Promise.all([first, second]),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("milestone accept lock timed out")), 2000)),
    ]);
    assert.equal(creates, 1);
    assert.equal(invoices.length, 1);
    assert.equal(entries[0]?.invoiceId, invoices[0]?.id);
    assert.equal(milestone.status, "accepted");
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
    assert.equal(responses.filter((response) => response.body.changed === true).length, 1);
  } finally {
    releaseHold();
    await server.close();
  }
});

test("session clients can accept a milestone, and invoice writes require billing:write", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const entries: Entry[] = [{ id: randomUUID(), contractId, label: "Milestone acceptance", amountMinor: 225_000, currency: usd, trigger: "milestone_accepted", invoiceId: null }];
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Launch", description: "", dueDate: null, status: "submitted", retainageMinor: null, retainageCurrency: null,
  };
  const invoices: Invoice[] = [];
  const tokens = new Map<string, Token>();
  const staffToken = "staff-billing-token";
  const narrowToken = "read-only-token";
  const clientToken = "client-billing-token";
  tokens.set(hash(staffToken), {
    tokenHash: hash(staffToken), revokedAt: null, expiresAt: null, userId, scopes: ["billing:write"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "staff", organizationId }] },
  });
  tokens.set(hash(narrowToken), {
    tokenHash: hash(narrowToken), revokedAt: null, expiresAt: null, userId, scopes: ["billing:read"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "staff", organizationId }] },
  });
  tokens.set(hash(clientToken), {
    tokenHash: hash(clientToken), revokedAt: null, expiresAt: null, userId, scopes: ["billing:write"],
    client: { organizationId }, user: { memberships: [{ status: "active", role: "client", organizationId }] },
  });
  const db = store({
    entries, milestones: [milestone], projects: [{ id: milestone.projectId, contractId, organizationId }], invoices,
    contracts: [{ id: contractId, organizationId }], tokens,
  });
  const app = express();
  app.use(express.json());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const sessionUser = request.header("x-user-id");
    if (sessionUser) Object.assign(request, { session: { userId: sessionUser, organizationId } });
    next();
  });
  app.use("/api/v1", createBillingProjectsRouter({ prisma: db as never }));
  const server = await listen(app);
  try {
    const accepted = await call(server.origin, `/milestones/${milestoneId}/accept`, { headers: { "x-user-id": userId } });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.changed, true);
    assert.equal(invoices[0]?.amountMinor, 225_000);
    assert.equal(milestone.status, "accepted");

    const denied = await call(server.origin, "/invoices", {
      method: "POST",
      headers: { authorization: `Bearer ${narrowToken}` },
      body: JSON.stringify({ contractId, amount: { amountMinor: 100, currency: usd }, dueDate: "2026-08-01" }),
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "SCOPE_REQUIRED");
    assert.match(String(denied.body.message), /billing:write/);

    const client = await call(server.origin, "/invoices", {
      method: "POST",
      headers: { authorization: `Bearer ${clientToken}` },
      body: JSON.stringify({ contractId, amount: { amountMinor: 100, currency: usd }, dueDate: "2026-08-01" }),
    });
    assert.equal(client.status, 403);
    assert.equal(client.body.code, "FORBIDDEN");

    const created = await call(server.origin, "/invoices", {
      method: "POST",
      headers: { authorization: `Bearer ${staffToken}` },
      body: JSON.stringify({ contractId, amount: { amountMinor: 100, currency: usd }, dueDate: "2026-08-01" }),
    });
    assert.equal(created.status, 201);
    assert.equal((created.body.entity as { amount: { amountMinor: number }; status: string }).status, "draft");
  } finally {
    await server.close();
  }
});

test("each milestone invoices only its own entries, and an unassigned remainder waits for the final milestone", async () => {
  const contractId = randomUUID();
  const projectId = randomUUID();
  const earlyId = randomUUID();
  const finalId = randomUUID();
  const entries: Entry[] = [
    { id: randomUUID(), contractId, label: "Design acceptance", amountMinor: 40_000, currency: usd, trigger: "milestone_accepted", milestoneId: earlyId, invoiceId: null },
    { id: randomUUID(), contractId, label: "Milestone acceptance", amountMinor: 150_000, currency: usd, trigger: "milestone_accepted", milestoneId: null, invoiceId: null },
  ];
  const early: Milestone = {
    id: earlyId, projectId, title: "Design", description: "", dueDate: new Date("2026-05-01T00:00:00.000Z"), status: "submitted", retainageMinor: null, retainageCurrency: null,
  };
  const finalMilestone: Milestone = {
    id: finalId, projectId, title: "Launch", description: "", dueDate: new Date("2026-08-01T00:00:00.000Z"), status: "submitted", retainageMinor: 2_000, retainageCurrency: usd,
  };
  const invoices: Invoice[] = [];
  const db = store({
    entries, milestones: [early, finalMilestone], projects: [{ id: projectId, contractId, organizationId }], invoices, contracts: [{ id: contractId, organizationId }],
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "staff", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const acceptedEarly = await call(server.origin, `/milestones/${earlyId}/accept`);
    assert.equal(acceptedEarly.status, 200);
    assert.equal(acceptedEarly.body.changed, true);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.amountMinor, 40_000);
    assert.equal(entries[0]?.invoiceId, invoices[0]?.id);
    assert.equal(entries[0]?.milestoneId, earlyId);
    assert.equal(entries[1]?.invoiceId, null);

    const acceptedFinal = await call(server.origin, `/milestones/${finalId}/accept`);
    assert.equal(acceptedFinal.status, 200);
    assert.equal(invoices.length, 2);
    assert.equal(invoices[1]?.amountMinor, 152_000);
    assert.equal(entries[1]?.invoiceId, invoices[1]?.id);
    assert.equal(entries[1]?.milestoneId, finalId);
    assert.equal((acceptedFinal.body.links as { invoice?: string }).invoice, `/api/v1/invoices/${invoices[1]?.id}`);

    const repeatFinal = await call(server.origin, `/milestones/${finalId}/accept`);
    assert.equal(repeatFinal.body.changed, false);
    assert.equal(invoices.length, 2);
    assert.equal((repeatFinal.body.links as { invoice?: string }).invoice, `/api/v1/invoices/${invoices[1]?.id}`);
  } finally {
    await server.close();
  }
});

test("one milestone still invoices the unassigned fixed-price remainder", async () => {
  const contractId = randomUUID();
  const milestoneId = randomUUID();
  const entries: Entry[] = [
    { id: randomUUID(), contractId, label: "Milestone acceptance", amountMinor: 150_000, currency: usd, trigger: "milestone_accepted", milestoneId: null, invoiceId: null },
  ];
  const milestone: Milestone = {
    id: milestoneId, projectId: randomUUID(), title: "Launch", description: "", dueDate: null, status: "submitted", retainageMinor: null, retainageCurrency: null,
  };
  const invoices: Invoice[] = [];
  const db = store({
    entries, milestones: [milestone], projects: [{ id: milestone.projectId, contractId, organizationId }], invoices, contracts: [{ id: contractId, organizationId }],
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createBillingProjectsRouter({
    prisma: db as never,
    authorize: () => ({ userId, organizationId, role: "client", scopes: ["projects:write"] }),
  }));
  const server = await listen(app);
  try {
    const accepted = await call(server.origin, `/milestones/${milestoneId}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.amountMinor, 150_000);
    assert.equal(entries[0]?.milestoneId, milestoneId);
  } finally {
    await server.close();
  }
});

test("billing entry labels are unique per contract and entries can name a milestone", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../../prisma/migrations/0011_billing_entry_contract_label/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /@@unique\(\[contractId, label\]\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "BillingEntry_contractId_label_key"/);
  assert.match(migration, /"contractId", "label"/);
  const milestoneMigration = readFileSync(new URL("../../prisma/migrations/0012_billing_entry_milestone/migration.sql", import.meta.url), "utf8");
  assert.match(schema, /milestoneId\s+String\?/);
  assert.match(milestoneMigration, /ADD COLUMN "milestoneId"/);
  assert.match(milestoneMigration, /REFERENCES public."Milestone"/);
});

function store(input: {
  entries: Entry[];
  milestones: Milestone[];
  projects: Array<{ id: string; contractId: string; organizationId: string }>;
  invoices: Invoice[];
  contracts: Array<{ id: string; organizationId: string }>;
  tokens?: Map<string, Token>;
  onCreateInvoice?: () => Promise<void>;
}) {
  const milestones = new Map(input.milestones.map((milestone) => [milestone.id, milestone]));
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const contracts = new Map(input.contracts.map((contract) => [contract.id, contract]));
  let owner: symbol | null = null;
  const waiters: Array<() => void> = [];
  const billingEntry = {
    findMany: async ({ where }: { where: { contractId?: string; trigger?: string; invoiceId?: null | { not: null } } }) =>
      input.entries.filter((entry) => matchesEntry(entry, where)).map((entry) => ({ ...entry })),
    updateMany: async ({ where, data }: { where: { id: { in: string[] }; invoiceId: null }; data: { invoiceId: string; milestoneId?: string } }) => {
      let count = 0;
      for (const entry of input.entries) {
        if (!where.id.in.includes(entry.id) || entry.invoiceId !== null) continue;
        entry.invoiceId = data.invoiceId;
        if (data.milestoneId) entry.milestoneId = data.milestoneId;
        count += 1;
      }
      return { count };
    },
    count: async () => input.entries.length,
  };
  const invoiceApi = {
    create: async ({ data }: { data: Omit<Invoice, "id" | "paidAt" | "createdAt" | "status"> & { status?: string } }) => {
      await input.onCreateInvoice?.();
      const invoice: Invoice = { id: randomUUID(), paidAt: null, createdAt: new Date(), ...data, status: data.status ?? "draft" };
      input.invoices.push(invoice);
      return invoice;
    },
    findUnique: async ({ where }: { where: { id: string } }) => input.invoices.find((invoice) => invoice.id === where.id) ?? null,
    findFirst: async () => input.invoices[0] ?? null,
  };
  const milestoneApi = {
    findMany: async ({ where }: { where?: { project?: { contractId?: string } } }) =>
      [...milestones.values()].filter((milestone) => {
        const project = projects.get(milestone.projectId);
        return !where?.project?.contractId || project?.contractId === where.project.contractId;
      }).map((milestone) => ({ id: milestone.id, dueDate: milestone.dueDate })),
    findUnique: async ({ where }: { where: { id: string } }) => {
      const milestone = milestones.get(where.id);
      if (!milestone) return null;
      const project = projects.get(milestone.projectId);
      if (!project) return null;
      return { ...milestone, project: { ...project } };
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Milestone> }) => {
      const milestone = milestones.get(where.id);
      if (!milestone) throw Object.assign(new Error("missing"), { code: "P2025" });
      Object.assign(milestone, data);
      return { ...milestone };
    },
  };
  const db = {
    billingEntry,
    invoice: invoiceApi,
    milestone: milestoneApi,
    contract: {
      findFirst: async ({ where }: { where: { id: string; organizationId?: string } }) => {
        const contract = contracts.get(where.id);
        if (!contract || (where.organizationId && contract.organizationId !== where.organizationId)) return null;
        return contract;
      },
    },
    membership: {
      findUnique: async () => ({ organizationId, role: "client" as const, status: "active" }),
      findFirst: async () => ({ organizationId, role: "client" as const, status: "active" }),
    },
    mcpToken: {
      findFirst: async ({ where }: { where: { tokenHash: string } }) => {
        const token = input.tokens?.get(where.tokenHash);
        if (!token || token.revokedAt) return null;
        if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;
        return token;
      },
    },
    $queryRawUnsafe: async () => [],
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
  return db;
}

async function call(origin: string, path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<{ status: number; body: { ok?: boolean; changed?: boolean; code?: string; message?: string; entity?: unknown; links?: unknown } }> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method: init?.method ?? "POST",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: init?.body ?? "{}",
  });
  return { status: response.status, body: await response.json() as { ok?: boolean; changed?: boolean; code?: string; message?: string; entity?: unknown; links?: unknown } };
}
