// These tests record the MCP server's API calls; agent-trace posts are covered in demo.test.ts.
process.env.UNWH_MCP_TRACE = "off";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test, after } from "node:test";
import express from "express";
import { createChatProposalReadRouter } from "../../server/routes/chatProposalRead.js";
import type { PrismaClient } from "@prisma/client";

const fakePrisma = {} as PrismaClient;
const app = express();
app.use(express.json());
const router = createChatProposalReadRouter({ prisma: fakePrisma, resolveAuth: () => undefined });
app.use("/api/v1", router);
const server: Server = createServer(app);
const listening = new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
await listening;
const address = server.address();
assert(address && typeof address !== "string");
const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

after(() => server.close());

test("registers chat, public proposal workspace, and proposal read operations", () => {
  const routes = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`);
  assert.deepEqual(routes, [
    "POST /public/proposal-sessions", "GET /public/proposal-sessions", "POST /public/proposal-sessions/messages", "POST /public/proposal-sessions/submit",
    "POST /chat/sessions", "GET /chat/sessions", "GET /chat/sessions/:id", "POST /chat/sessions/:id/messages",
    "GET /chat/sessions/:id/messages", "POST /chat/sessions/:id/escalate", "POST /chat/sessions/:id/takeover",
    "POST /chat/sessions/:id/handback", "GET /proposals", "POST /proposals", "GET /proposals/:id",
    "GET /proposals/:id/status", "POST /proposals/:id/views", "GET /proposals/:id/views", "GET /proposals/:id/sections", "PATCH /proposals/:id", "DELETE /proposals/:id",
  ]);
});

test("protected operations use the shared auth error envelope", async () => {
  const response = await fetch(`${baseUrl}/chat/sessions`);
  assert.equal(response.status, 401);
  assert.deepEqual((await response.json()).ok, false);
});

test("PATCH /proposals/:id returns version equal to the previous value plus 1", async () => {
  const id = "d534b0d5-3b68-4fab-96a5-b6a96c58ec4d";
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-10-21T00:00:00.000Z");
  const previousVersion = 1;
  const stored = {
    id, ownerId, organizationId: null, title: "Before", engagement: "workflow_check", status: "draft",
    scope: { summary: "A workflow", deliverables: ["A written plan"], assumptions: [], exclusions: [] },
    timeline: { startDate: null, targetDate: null },
    pricingModel: "workflow_check",
    pricing: { model: "workflow_check", amountMinor: 25000, currency: "USD" },
    version: previousVersion, createdAt: now, updatedAt: now, options: [], milestones: [],
  };
  const prisma = {
    proposal: {
      findUnique: async () => ({ ...stored, options: [], milestones: [] }),
      update: async ({ data }: { data: { version?: { increment: number }; title?: string } }) => {
        stored.title = data.title ?? stored.title;
        stored.version += data.version?.increment ?? 0;
        return stored;
      },
    },
  } as unknown as PrismaClient;
  const patchApp = express();
  patchApp.use(express.json());
  patchApp.use("/api/v1", createChatProposalReadRouter({
    prisma,
    resolveAuth: () => ({ userId: ownerId, role: "client", scopes: ["proposals:write", "proposals:read"] }),
  }));
  const patchServer = createServer(patchApp);
  await new Promise<void>((resolve) => patchServer.listen(0, "127.0.0.1", resolve));
  const patchAddress = patchServer.address();
  assert(patchAddress && typeof patchAddress !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${patchAddress.port}/api/v1/proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "After" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entity.version, previousVersion + 1);
    assert.equal(body.entity.title, "After");
  } finally {
    patchServer.close();
  }
});

test("GET /proposals for staff defaults to their organization with no query params", async () => {
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const calls: any[] = [];
  const prisma = {
    proposal: {
      findMany: async (args: any) => { calls.push(args); return []; },
    },
  } as unknown as PrismaClient;
  const listApp = express();
  listApp.use(express.json());
  listApp.use("/api/v1", createChatProposalReadRouter({
    prisma,
    resolveAuth: () => ({ userId: "11111111-1111-4111-8111-111111111111", organizationId, role: "staff", scopes: ["proposals:read"] }),
  }));
  const listServer = createServer(listApp);
  await new Promise<void>((resolve) => listServer.listen(0, "127.0.0.1", resolve));
  const address = listServer.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.entity.items, []);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].where, { organizationId });
  } finally {
    listServer.close();
  }
});

test("GET /proposals skips invalid legacy rows instead of failing the page", async () => {
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const goodId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const badId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const now = new Date("2026-10-21T00:00:00.000Z");
  const good = {
    id: goodId,
    ownerId,
    organizationId: null,
    title: "Good",
    engagement: "workflow_check",
    status: "draft",
    scope: { summary: "A workflow", deliverables: ["A written plan"], assumptions: [], exclusions: [] },
    timeline: { startDate: null, targetDate: null },
    pricingModel: "workflow_check",
    pricing: { model: "workflow_check", amountMinor: 25000, currency: "USD" },
    version: 1,
    createdAt: now,
    updatedAt: now,
    options: [],
    milestones: [],
  };
  const bad = {
    ...good,
    id: badId,
    title: "Bad legacy row",
    // Legacy malformed pricing: missing amountMinor (reported root cause)
    pricing: { model: "workflow_check", currency: "USD" },
  };
  const prisma = {
    proposal: {
      findMany: async () => [good, bad],
    },
  } as unknown as PrismaClient;
  const listApp = express();
  listApp.use(express.json());
  listApp.use("/api/v1", createChatProposalReadRouter({
    prisma,
    resolveAuth: () => ({ userId: ownerId, role: "client", scopes: ["proposals:read"] }),
  }));
  const listServer = createServer(listApp);
  await new Promise<void>((resolve) => listServer.listen(0, "127.0.0.1", resolve));
  const address = listServer.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.entity.items.map((item: any) => item.id), [goodId]);
  } finally {
    listServer.close();
  }
});

test("public chat creation validates its request body", async () => {
  const response = await fetch(`${baseUrl}/chat/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "not-an-agent" }) });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION_FAILED");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
});

test("PATCH /proposals/:id writes timeline milestones to the milestone table and bumps version once", async () => {
  const id = "d534b0d5-3b68-4fab-96a5-b6a96c58ec4d";
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-10-21T00:00:00.000Z");
  const stored: any = {
    id, ownerId, organizationId: null, title: "Timeline test", engagement: "workflow_check", status: "draft",
    scope: { summary: "A workflow", deliverables: ["A written plan"], assumptions: [], exclusions: [] },
    timeline: { startDate: null, targetDate: null, milestones: [] },
    pricingModel: "workflow_check",
    pricing: { model: "workflow_check", amountMinor: 25000, currency: "USD" },
    version: 1, createdAt: now, updatedAt: now, options: [], milestones: [],
  };
  const table: any[] = [];
  const nodeUpdates: any[] = [];
  const prisma = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(prisma),
    timelineMilestone: {
      deleteMany: async () => { table.length = 0; return { count: 0 }; },
      createMany: async ({ data }: { data: any[] }) => { table.push(...data.map((row, index) => ({ id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`, ...row }))); return { count: data.length }; },
    },
    proposalNode: {
      findMany: async () => [{ key: "schedule", stateCode: "open", body: {} }, { key: "milestones", stateCode: "open", body: {} }],
      updateMany: async ({ data, where }: { data: any; where: any }) => { nodeUpdates.push({ data, where }); return { count: 1 }; },
    },
    proposal: {
      findUnique: async () => ({ ...stored, options: [], milestones: table.map((row) => ({ id: row.id, title: row.title, description: row.description, dueDate: row.dueDate })) }),
      update: async ({ data }: { data: { version?: { increment: number }; timeline?: any } }) => {
        stored.version += data.version?.increment ?? 0;
        if (data.timeline) stored.timeline = data.timeline;
        return stored;
      },
    },
  } as unknown as PrismaClient;
  const patchApp = express();
  patchApp.use(express.json());
  patchApp.use("/api/v1", createChatProposalReadRouter({
    prisma,
    resolveAuth: () => ({ userId: ownerId, role: "client", scopes: ["proposals:write", "proposals:read"] }),
  }));
  const patchServer = createServer(patchApp);
  await new Promise<void>((resolve) => patchServer.listen(0, "127.0.0.1", resolve));
  const address = patchServer.address();
  assert(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        timeline: {
          startDate: "2026-11-16",
          targetDate: "2027-01-25",
          milestones: [
            { title: "Kickoff", description: "Start", weekOffset: 1 },
            { title: "Launch", description: "Go live", weekOffset: 10 },
          ],
        },
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.entity.version, 2);
    assert.equal(body.entity.timeline.startDate, "2026-11-16");
    assert.equal(body.entity.timeline.milestones.length, 2);
    assert.equal(body.entity.timeline.milestones[0].dueDate, "2026-11-23");
    assert.equal(body.entity.timeline.milestones[1].dueDate, "2027-01-25");
    assert.equal(body.warnings.length, 0);
    assert.match(body.links.portal, /\/portal\?proposal=/);
    assert.equal(table.length, 2);
    assert.equal(stored.version, 2);
    assert.ok(nodeUpdates.length >= 1);
  } finally {
    patchServer.close();
  }
});
