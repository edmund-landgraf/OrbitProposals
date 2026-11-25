// unw_list_proposal_sections reads GET /proposals/:id/sections: each section's key, title, and order, from the proposal's nodes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../server/prismaClient.js";
import { createChatProposalReadRouter, sectionListView } from "../../server/routes/chatProposalRead.js";

const url = process.env.UNWH_DB_TEST === "1" ? process.env.DATABASE_URL : undefined;
const skip = !url && "set UNWH_DB_TEST=1 and DATABASE_URL";

test("section list view orders by sortOrder and numbers from 1", () => {
  const view = sectionListView([
    { key: "pricing", title: "Pricing", clientLabel: "Price", kind: "section", stateCode: "open", sortOrder: 30, parentKey: null },
    { key: "scope", title: "Scope", clientLabel: "What we'll do", kind: "section", stateCode: "settled", sortOrder: 10, parentKey: null },
  ]);
  assert.deepEqual(view.map((s) => [s.key, s.title, s.order, s.status]), [["scope", "Scope", 1, "settled"], ["pricing", "Pricing", 2, "open"]]);
  assert.equal(view[0].id, "scope");
});

test("GET /proposals/:id/sections returns each node's key, title, and order", { skip }, async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  const owner = await prisma.user.create({ data: { email: `list-sections-${randomUUID()}@test.invalid`, displayName: "List sections" } });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createChatProposalReadRouter({ prisma, resolveAuth: () => ({ userId: owner.id, role: "client", scopes: ["proposals:read"] }) }));
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    const proposal = await prisma.proposal.create({ data: { ownerId: owner.id, title: "Listed sections", engagement: "fixed_price", pricingModel: "fixed_price", scope: { summary: "To be written.", deliverables: ["To be written"] }, timeline: {}, pricing: { model: "fixed_price", currency: "USD" } } });
    const state = await prisma.proposalNodeState.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
    await prisma.proposalNode.createMany({ data: [
      { proposalId: proposal.id, key: "zeta", kind: "section", title: "Zeta section", clientLabel: "Zeta", stateCode: state.code, sortOrder: 20 },
      { proposalId: proposal.id, key: "alpha", kind: "section", title: "Alpha section", clientLabel: "Alpha", stateCode: state.code, sortOrder: 10 },
    ] });
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/proposals/${proposal.id}/sections`);
    assert.equal(response.status, 200);
    const body = await response.json() as { entity: { sections: { key: string; title: string; order: number; status: string }[] } };
    assert.deepEqual(body.entity.sections.map((s) => [s.key, s.title, s.order]), [["alpha", "Alpha section", 1], ["zeta", "Zeta section", 2]]);
    assert.equal(body.entity.sections[0].status, state.code);
  } finally {
    server.close();
    await prisma.proposal.deleteMany({ where: { ownerId: owner.id } });
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
