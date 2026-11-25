// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T> = { ok: boolean; code?: string; entity: T };
type Template = { code: string; name: string; nodes: { key: string; parentKey: string | null }[] };

test("proposal templates choose which parts a proposal is built from", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const code = `test_${randomUUID().slice(0, 8)}`;
  await prisma.proposalTemplate.create({ data: { code, name: "Small test template", description: "Scope, price and an executive summary.", sortOrder: 999, nodes: { create: [
    { nodeKey: "scope", sortOrder: 10 },
    { nodeKey: "price", sortOrder: 20, parentKey: "hours" },
    { nodeKey: "executive_summary", sortOrder: 30 },
  ] } } });
  const owner = await prisma.user.create({ data: { email: `templates-${randomUUID()}@test.invalid`, displayName: "Templates" } });
  const make = () => prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Templates", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map the intake workflow." }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
  } });
  const small = await make();
  const standard = await make();
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const call = async <T>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope<T> };
  };
  try {
    const listed = await call<Template[]>("/proposal-templates");
    assert.equal(listed.status, 200);
    const standardRow = listed.body.entity.find((row) => row.code === "standard");
    assert.ok(standardRow && standardRow.nodes.length >= 11, "standard holds every node");
    assert.ok(listed.body.entity.some((row) => row.code === code));

    assert.equal((await call(`/proposals/${small.id}/template`, "PUT", { code: "no_such_template" })).status, 404);
    const set = await call<Template>(`/proposals/${small.id}/template`, "PUT", { code });
    assert.equal(set.status, 200);
    const nodes = await prisma.proposalNode.findMany({ where: { proposalId: small.id }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(nodes.map((node) => node.key), ["scope", "price", "executive_summary"]);
    assert.equal(nodes.find((node) => node.key === "price")?.parentKey, null, "a parent outside the template is dropped");
    assert.equal((await call(`/proposals/${small.id}/template`, "PUT", { code })).status, 200, "same template again is a no-op");
    const scopeNode = await prisma.proposalNode.findFirstOrThrow({ where: { proposalId: small.id, key: "scope" } });
    await prisma.proposalNode.update({ where: { id: scopeNode.id }, data: { body: { text: "Keep this scope." } } });
    const switched = await call<Template>(`/proposals/${small.id}/template`, "PUT", { code: "standard" });
    assert.equal(switched.status, 200, "a draft can switch template after parts exist");
    const rebuilt = await prisma.proposalNode.findMany({ where: { proposalId: small.id }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(rebuilt.map((node) => node.key), standardRow!.nodes.map((node) => node.key));
    assert.deepEqual(rebuilt.find((node) => node.key === "scope")?.body, { text: "Keep this scope." });
    const version = await prisma.proposalVersion.create({ data: { proposalId: small.id, number: 1, snapshot: {} } });
    await prisma.proposalNode.update({ where: { id: rebuilt[0]!.id }, data: { lockedVersionId: version.id } });
    assert.equal((await call(`/proposals/${small.id}/template`, "PUT", { code })).status, 409, "a locked section blocks another template");

    await call(`/proposals/${standard.id}/completion`);
    const built = await prisma.proposalNode.count({ where: { proposalId: standard.id } });
    assert.equal(built, standardRow!.nodes.length, "a proposal with no template choice gets the standard parts");
  } finally {
    server.close();
    await prisma.proposal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.proposalTemplate.delete({ where: { code } });
    await prisma.$disconnect();
  }
});