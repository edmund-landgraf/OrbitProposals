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

type Entry = { key: string; category: string; guidance: string | null };

test("section library adds optional sections to a built proposal", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `library-${randomUUID()}@test.invalid`, displayName: "Library" } });
  const proposal = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Library", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Move the CRM data." }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
  } });
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
    const listed = await call<Entry[]>("/proposal-section-library");
    assert.equal(listed.status, 200);
    const keys = listed.body.entity.map((row) => row.key);
    for (const key of ["security", "data_migration", "service_levels", "training"]) assert.ok(keys.includes(key), key);
    assert.ok(listed.body.entity.every((row) => row.guidance), "every library section has guidance");

    const standard = await prisma.proposalTemplateNode.findMany({ where: { templateCode: "standard", nodeKey: { in: keys } } });
    assert.equal(standard.length, 0, "library sections are not in the standard template");

    assert.equal((await call(`/proposals/${proposal.id}/sections`, "POST", { nodeKey: "scope" })).status, 404, "core parts are not library sections");
    const added = await call<Entry>(`/proposals/${proposal.id}/sections`, "POST", { nodeKey: "data_migration" });
    assert.equal(added.status, 201);
    assert.equal((await call(`/proposals/${proposal.id}/sections`, "POST", { nodeKey: "data_migration" })).status, 200, "adding again is a no-op");
    const nodes = await prisma.proposalNode.findMany({ where: { proposalId: proposal.id, key: "data_migration" } });
    assert.equal(nodes.length, 1);

    const written = await call(`/proposals/${proposal.id}/narrative/data_migration`, "PUT", { text: "Customer records move from the legacy CRM to the new one, mapped field by field and verified by row counts." });
    assert.equal(written.status, 200, "the narrative route writes a library section");
  } finally {
    server.close();
    await prisma.proposal.delete({ where: { id: proposal.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});