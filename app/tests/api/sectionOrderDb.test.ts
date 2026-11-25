// Removing and reordering proposal sections: idempotent removal, locked and parent parts refused, partial reorder.
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

test("sections can be removed and reordered", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `reorder-${randomUUID()}@test.invalid`, displayName: "Reorder" } });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((request, _response, next) => { request.session.userId = owner.id; next(); });
  app.use("/api/v1", createProposalCompletionRouter({ prisma }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const send = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { ok: boolean; changed: boolean; entity: { removed?: boolean; sections?: { key: string; order: number }[] }; error?: { code: string } } };
  };
  try {
    const proposal = await prisma.proposal.create({ data: { ownerId: owner.id, title: "Reorder sections", engagement: "fixed_price", pricingModel: "fixed_price", scope: { summary: "To be written.", deliverables: ["To be written"] }, timeline: {}, pricing: { model: "fixed_price", currency: "USD" } } });
    const base = `/proposals/${proposal.id}`;
    assert.equal((await send("POST", `${base}/sections`, { nodeKey: "security" })).status, 201);
    assert.equal((await send("POST", `${base}/sections`, { nodeKey: "training" })).status, 201);
    const top = await prisma.proposalNode.findMany({ where: { proposalId: proposal.id, parentKey: null }, orderBy: [{ sortOrder: "asc" }, { key: "asc" }] });

    const moved = await send("PUT", `${base}/section-order`, { keys: ["training", "security"] });
    assert.equal(moved.status, 200);
    assert.deepEqual(moved.body.entity.sections!.slice(0, 2).map((s) => s.key), ["training", "security"]);
    assert.equal(moved.body.entity.sections!.length, top.length, "unlisted siblings are kept");
    const after = await prisma.proposalNode.findMany({ where: { proposalId: proposal.id, parentKey: null }, orderBy: { sortOrder: "asc" } });
    assert.deepEqual(after.map((n) => n.key), moved.body.entity.sections!.map((s) => s.key));
    assert.equal((await send("PUT", `${base}/section-order`, { keys: ["training", "security"] })).body.changed, false, "same order again is a no-op");
    assert.equal((await send("PUT", `${base}/section-order`, { keys: ["nope"] })).status, 400);
    assert.equal((await send("PUT", `${base}/section-order`, { keys: ["training", "training"] })).status, 400);

    const removed = await send("DELETE", `${base}/sections/training`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.entity.removed, true);
    const again = await send("DELETE", `${base}/sections/training`);
    assert.equal(again.body.changed, false);
    assert.equal(await prisma.proposalNode.count({ where: { proposalId: proposal.id, key: "training" } }), 0);

    const lock = await prisma.proposalNodeState.findFirst({ where: { isLock: true } });
    if (lock) {
      await prisma.proposalNode.updateMany({ where: { proposalId: proposal.id, key: "security" }, data: { stateCode: lock.code } });
      const locked = await send("DELETE", `${base}/sections/security`);
      assert.equal(locked.status, 409);
      assert.equal(await prisma.proposalNode.count({ where: { proposalId: proposal.id, key: "security" } }), 1);
    }
    const parent = after.find((n) => n.key !== "security" && n.key !== "training")!;
    await prisma.proposalNode.create({ data: { proposalId: proposal.id, key: `child-${randomUUID().slice(0, 8)}`, kind: parent.kind, title: "Child", clientLabel: "Child", stateCode: parent.stateCode, sortOrder: 1, parentKey: parent.key } });
    assert.equal((await send("DELETE", `${base}/sections/${parent.key}`)).status, 409, "a section with sub-parts is refused");
  } finally {
    server.close();
    await prisma.proposal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
