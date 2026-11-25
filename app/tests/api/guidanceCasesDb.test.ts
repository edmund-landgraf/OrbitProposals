// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
// Case library: staff rate a turn, promote the rating to a case, approve it, and the agent finds it by similar signals.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createGuidanceCaseEditRouter } from "../../server/routes/guidanceCaseEdit.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";
import { caseSimilarity, rankCases } from "../../server/guidanceCases.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

test("case similarity counts matching signals", () => {
  assert.equal(caseSimilarity({ a: 1, b: "x" }, { a: 1, b: "y" }), 0.5);
  assert.equal(caseSimilarity({}, { a: 1 }), 0);
  const base = { title: "t", situation: "s", clientPhrase: null, lesson: "l", tags: [], updatedAt: new Date() };
  const ranked = rankCases([
    { ...base, key: "far", signals: { a: 2 }, move: "ask", polarity: 1 },
    { ...base, key: "near", signals: { a: 1 }, move: "ask", polarity: -1 },
    { ...base, key: "other", signals: { a: 1 }, move: "handoff", polarity: 1 },
  ], { a: 1 }, { move: "ask" });
  assert.deepEqual(ranked.map((row) => row.key), ["near", "far"]);
  assert.equal(ranked[0].outcome, "avoid");
});

test("staff feedback becomes an approved case the agent can find", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const tag = randomUUID().slice(0, 8);
  const org = await prisma.organization.create({ data: { name: "Case library", slug: `cases-${tag}` } });
  const staff = await prisma.user.create({ data: { email: `staff-${tag}@test.invalid`, displayName: "Staff" } });
  const client = await prisma.user.create({ data: { email: `client-${tag}@test.invalid`, displayName: "Client" } });
  await prisma.membership.create({ data: { userId: staff.id, organizationId: org.id, role: "staff", status: "active" } });
  await prisma.membership.create({ data: { userId: client.id, organizationId: org.id, role: "client", status: "active" } });
  let as = staff.id;
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = as; request.session.organizationId = org.id; next(); });
  app.use("/api/v1", createGuidanceCaseEditRouter({ prisma }));
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; entity: any; code?: string } };
  };
  const key = `case_${tag}`;
  const proposal = await prisma.proposal.create({ data: { ownerId: client.id, organizationId: org.id, title: "Cases", engagement: "fixed_price", pricingModel: "fixed_price", scope: { summary: "To be written.", deliverables: ["To be written"] }, timeline: {}, pricing: { model: "fixed_price", currency: "USD" } } });
  const signals = { client_unsure: true, open_parts: 3 };
  const event = await prisma.guidanceSessionEvent.create({ data: { proposalId: proposal.id, sessionId: `s-${tag}`, turnIndex: 1, signals, chosenMove: "recommend_handoff" } });
  try {
    as = client.id;
    assert.equal((await call("/staff/guidance-cases")).status, 403);
    as = staff.id;
    assert.equal((await call("/staff/guidance-feedback", "POST", { proposalId: proposal.id, eventId: event.id, rating: "meh" })).status, 400);
    const feedback = await call("/staff/guidance-feedback", "POST", { proposalId: proposal.id, sessionId: `s-${tag}`, eventId: event.id, rating: "good", note: "Nice handoff." });
    assert.equal(feedback.status, 201);
    const pending = await call("/staff/guidance-feedback?unpromoted=1");
    assert.ok(pending.body.entity.some((row: { id: string }) => row.id === feedback.body.entity.id));

    const created = await call("/staff/guidance-cases", "POST", { key, feedbackId: feedback.body.entity.id, title: "Unsure client", situation: "Client unsure about hosting.", lesson: "Offer a human early." });
    assert.equal(created.status, 201);
    assert.equal(created.body.entity.polarity, 1, "polarity comes from the rating row");
    assert.equal(created.body.entity.move, "recommend_handoff", "move comes from the rated event");
    assert.deepEqual(created.body.entity.signals, signals);
    assert.equal(created.body.entity.statusCode, "draft");
    assert.equal((await call("/staff/guidance-cases", "POST", { key: `${key}_2`, feedbackId: feedback.body.entity.id, title: "x", situation: "x", lesson: "x" })).status, 409);

    const draftView = await call(`/proposals/${proposal.id}/guidance-cases`);
    assert.equal(draftView.status, 200);
    assert.ok(!draftView.body.entity.cases.some((row: { key: string }) => row.key === key), "drafts are not shown to the agent");

    assert.equal((await call(`/staff/guidance-cases/${key}`, "PATCH", { status: "nope" })).status, 400);
    assert.equal((await call(`/staff/guidance-cases/${key}`, "PATCH", { status: "approved" })).status, 200);
    const found = await call(`/proposals/${proposal.id}/guidance-cases?move=recommend_handoff`);
    const hit = found.body.entity.cases.find((row: { key: string }) => row.key === key);
    assert.ok(hit, "approved case is returned");
    assert.equal(hit.similarity, 1);
    assert.equal(hit.outcome, "worked");
  } finally {
    server.close();
    await prisma.guidanceCase.deleteMany({ where: { key: { startsWith: key } } });
    await prisma.guidanceFeedback.deleteMany({ where: { proposalId: proposal.id } });
    await prisma.guidanceSessionEvent.deleteMany({ where: { proposalId: proposal.id } });
    await prisma.proposal.deleteMany({ where: { id: proposal.id } });
    await prisma.membership.deleteMany({ where: { organizationId: org.id } });
    await prisma.user.deleteMany({ where: { id: { in: [staff.id, client.id] } } });
    await prisma.organization.delete({ where: { id: org.id } });
    await prisma.$disconnect();
  }
});
