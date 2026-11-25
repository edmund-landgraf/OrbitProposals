// Runs against a real Postgres when UNWH_DB_TEST=1 and DATABASE_URL are set (CI applies migrations first).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import session from "express-session";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { deleteProposalCascade } from "../../server/routes/admin.js";
import { createProposalCompletionRouter } from "../../server/routes/proposalCompletion.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

type Envelope<T> = { ok: boolean; code?: string; entity: T };
type Progress = { headline: string; phrase: string; percent: number; settled: number; total: number; groups: Array<{ code: string; parts: Array<{ key: string }> }>; nextStep: { key: string | null; text: string }; savedForLater: { items: Array<{ summary: string }> }; sinceLastVisit: { direction: string; text: string } | null; toDiscuss: number; handoff: { ready: boolean; reasons: Array<{ code: string; note: string | null }>; discussParts: string[]; openParts: string[]; draftedParts: string[]; reopenedParts: string[]; openSummary: string } };

test("progress reads the completion tree, stores a per-viewer snapshot, and explains a drop", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `progress-${randomUUID()}@test.invalid`, displayName: "Progress" } });
  const proposal = await prisma.proposal.create({ data: {
    ownerId: owner.id, title: "Progress", engagement: "capped_hours_4", pricingModel: "capped_hours",
    scope: { summary: "Map the intake workflow.", deliverables: ["Map"] }, timeline: {}, pricing: { model: "capped_hours", hours: 4, amountMinor: 80000, currency: "USD" },
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
  const base = `http://127.0.0.1:${address.port}/api/v1/proposals/${proposal.id}`;
  const get = async <T>(path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Envelope<T> };
  };
  try {
    const first = await get<Progress>("/progress");
    assert.equal(first.status, 200);
    const total = await prisma.proposalNode.count({ where: { proposalId: proposal.id } });
    assert.equal(first.body.entity.headline, `0 of ${total} parts settled`);
    assert.equal(first.body.entity.phrase, "Just getting started");
    assert.equal(first.body.entity.sinceLastVisit, null);

    await prisma.proposalNode.updateMany({ where: { proposalId: proposal.id }, data: { stateCode: "agreed" } });
    const tree = await get<{ percent: number }>("/completion");
    const settled = await get<Progress>("/progress");
    assert.equal(settled.body.entity.percent, tree.body.entity.percent, "progress uses the same percent as the completion tree");
    assert.equal(settled.body.entity.headline, `${total} of ${total} parts settled`);
    assert.equal((await get("/progress/seen", "POST", {})).status, 200);
    assert.equal(await prisma.proposalProgressView.count({ where: { proposalId: proposal.id, viewerId: owner.id } }), 1);

    const applied = await get("/completion/apply", "POST", { nodeKey: "scope", change: "adding a mobile app" });
    assert.equal(applied.status, 200);
    await get("/parked-items", "POST", { summary: "Customer portal, phase 2" });
    const dropped = await get<Progress>("/progress");
    assert.equal(dropped.body.entity.headline, `${total - 4} of ${total} parts settled`);
    assert.equal(dropped.body.entity.sinceLastVisit?.direction, "down");
    assert.ok(dropped.body.entity.sinceLastVisit!.text.includes(`from 100% to ${Math.round(((total - 4) / total) * 100)}%. A change to scope (adding a mobile app) reopened Scope, Hours, Price and Milestones.`), dropped.body.entity.sinceLastVisit!.text);
    assert.deepEqual(dropped.body.entity.groups.find((group) => group.code === "reopened")?.parts.map((part) => part.key), ["scope", "hours", "price", "milestones"]);
    assert.equal(dropped.body.entity.nextStep.key, "scope");
    assert.deepEqual(dropped.body.entity.savedForLater.items.map((item) => item.summary), ["Customer portal, phase 2"]);
    assert.equal(dropped.body.entity.total, total);

    const marked = await get<Progress>("/progress?markSeen=true");
    assert.equal(marked.body.entity.sinceLastVisit?.direction, "down");
    assert.equal((await get<Progress>("/progress")).body.entity.sinceLastVisit, null, "after marking seen there is nothing new to explain");

    // Many ways to settle a part: unsure (talk to a human), staff decides, out of scope. All count; unsure goes on the call agenda.
    assert.equal(marked.body.entity.handoff.ready, false);
    assert.equal((await get("/completion/nodes/hours/resolve", "POST", { resolution: "unsure", note: "No idea how many hours" })).status, 200);
    assert.equal((await get("/completion/nodes/price/resolve", "POST", { resolution: "staff_decides" })).status, 200);
    assert.equal((await get("/completion/nodes/milestones/resolve", "POST", { resolution: "out_of_scope" })).status, 200);
    assert.equal((await get("/completion/nodes/scope/resolve", "POST", { resolution: "made_up" })).status, 422);
    assert.equal((await get("/handoff", "POST", { reasonCode: "scope_unbounded", note: "Integrations keep growing" })).status, 200);
    assert.equal((await get("/handoff", "POST", { reasonCode: "nope" })).status, 422);
    const resolved = await get<Progress>("/progress");
    assert.equal(resolved.body.entity.headline, `${total - 1} of ${total} parts settled, 1 to discuss with us`);
    assert.equal(resolved.body.entity.toDiscuss, 1);
    assert.equal(resolved.body.entity.handoff.ready, true);
    assert.deepEqual(resolved.body.entity.handoff.reasons.map((reason) => reason.code), ["client_unsure", "scope_unbounded"]);
    assert.deepEqual(resolved.body.entity.handoff.discussParts, ["Hours"]);
    assert.deepEqual(resolved.body.entity.handoff.openParts, []);
    assert.deepEqual(resolved.body.entity.handoff.draftedParts, []);
    assert.deepEqual(resolved.body.entity.handoff.reopenedParts, ["Scope"]);
    assert.equal(resolved.body.entity.handoff.openSummary, "Needs another look: Scope.");
  } finally {
    server.close();
    await deleteProposalCascade(prisma, proposal.id);
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
});
