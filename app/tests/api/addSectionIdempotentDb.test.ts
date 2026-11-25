// Adding a library section the proposal already has is a no-op: one node, changed:false, at the API and through MCP.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { createServer } from "../../unwh-mcp/src/createServer.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Handler = (args: unknown, extra: unknown) => Promise<{ structuredContent: { changed?: boolean } }>;
const handlerOf = (server: ReturnType<typeof createServer>, name: string): Handler => {
  const tool = (server as unknown as { _registeredTools: Record<string, { handler?: Handler; callback?: Handler }> })._registeredTools[name];
  return (tool.handler ?? tool.callback)!;
};

test("unw_add_proposal_section reports changed only when the API changed something", async () => {
  const realFetch = globalThis.fetch;
  let changed = true;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const target = String(input instanceof Request ? input.url : input);
    const body = target.includes("/sections") ? { ok: true, changed, entity: { nodeKey: "security" }, warnings: [], links: {} } : { ok: true };
    return new Response(JSON.stringify(body), { status: changed ? 201 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const previous = process.env.UNWH_MCP_TRACE;
  process.env.UNWH_MCP_TRACE = "0";
  try {
    const add = handlerOf(createServer({ apiOrigin: "http://api.test", bearer: "Bearer x", traceSink: null }), "unw_add_proposal_section");
    const args = { proposalId: randomUUID(), nodeKey: "security" };
    const extra = { signal: new AbortController().signal };
    assert.equal((await add(args, extra)).structuredContent.changed, true);
    changed = false;
    assert.equal((await add(args, extra)).structuredContent.changed, false);
  } finally {
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.UNWH_MCP_TRACE; else process.env.UNWH_MCP_TRACE = previous;
  }
});

test("adding 'security' twice leaves one node and the second add is changed:false", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `sections-${randomUUID()}@test.invalid`, displayName: "Sections" } });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; changed: boolean } };
  };
  try {
    const proposal = await prisma.proposal.create({ data: { ownerId: owner.id, title: "Idempotent sections", engagement: "fixed_price", pricingModel: "fixed_price", scope: { summary: "To be written.", deliverables: ["To be written"] }, timeline: {}, pricing: { model: "fixed_price", currency: "USD" } } });
    const first = await post(`/proposals/${proposal.id}/sections`, { nodeKey: "security" });
    assert.equal(first.status, 201);
    assert.equal(first.body.changed, true);
    const second = await post(`/proposals/${proposal.id}/sections`, { nodeKey: "security" });
    assert.equal(second.status, 200);
    assert.equal(second.body.changed, false);
    const [a, b] = await Promise.all([post(`/proposals/${proposal.id}/sections`, { nodeKey: "training" }), post(`/proposals/${proposal.id}/sections`, { nodeKey: "training" })]);
    assert.ok(a.body.ok && b.body.ok, "a concurrent repeat is not an error");
    assert.equal(await prisma.proposalNode.count({ where: { proposalId: proposal.id, key: "security" } }), 1);
    assert.equal(await prisma.proposalNode.count({ where: { proposalId: proposal.id, key: "training" } }), 1);
  } finally {
    server.close();
    await prisma.proposal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
